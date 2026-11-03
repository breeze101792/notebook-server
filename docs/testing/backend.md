# Backend test suite

`tests/test_app.py` is about 4,900 lines of stdlib `unittest`. It drives the real
Flask app through Flask's test client, so every test exercises the real
routing, decorators, path resolution, and write path.

The suite currently holds **435 test methods across 50 `TestCase` classes**
(plus `BaseTest` and `WorkspaceTestBase`, which are shared bases and hold no
tests). The table below maps the original core route/file classes; the later
ACP, workspace and CLI classes are not listed there (workspace coverage is
described below).

Run it:

```bash
# Whole suite
.venv_$(hostname)/bin/python -m unittest discover -s tests -v

# One class or method
.venv_$(hostname)/bin/python -m unittest tests.test_app.TestSearch.test_case_insensitive_finds_all -v

# pytest, if installed
.venv_$(hostname)/bin/python -m pytest tests
```

`unittest discover -s tests` only finds `test_app.py`; the DOM and browser
suites are JavaScript and are run separately.

## Isolation: a temp notebook and config

`app.py` resolves `DATA_DIR` and `CONFIG_DIR` at **import time** from
`NOTEBOOK_DATA_DIR` and `NOTEBOOK_CONFIG_DIR`, and calls `seed()` on the same
import. The test module therefore redirects both variables to a fresh temp
directory **before** it imports `app` (`tests/test_app.py:27-29`), then puts
the project root on `sys.path` and imports `app as nb` (`test_app.py:31`).
The project's real `notebook/` and `config/` are never touched.

`BaseTest.setUp` (`test_app.py:34-42`) resets that temp environment between
tests: it removes `nb.DATA_DIR` and `nb.CONFIG_DIR` if present, calls
`nb.seed()` to recreate `notebook/Welcome.md` and `config/config.json`
(`{}`), and builds a fresh `nb.app.test_client()`. It also provides two
helpers, `post(path, body)` and `jget(path)`, used throughout.

The auth-aware classes call `super().setUp()` and then reset the in-memory
login rate limiter with `nb._login_failures.clear()` (for example
`TestAuth.setUp`, `test_app.py:1352-1356`), so a test that intentionally
trips the five-failure lockout does not lock out the next test's client IP.
`TestAuth` and the other auth classes then write their own
`config/auth.json` with bcrypt-hashed passwords at a low cost factor so
tests stay fast.

## TestCase classes

| # | Class | Tests | Covers |
| --- | --- | --- | --- |
| 1 | `TestIndexAndSeed` | 13 | `GET /` HTML, first-paint boot state (sanitizing hostile config, clamping pane widths, not leaking content, defaults until authenticated), SPA catch-all boot state, seeding `Welcome.md` + empty config, seeded tree, and `Cache-Control: no-store` on gated reads |
| 2 | `TestSpaCatchAll` | 6 | Root, file-path, subfolder, and deep-link-with-fragment requests serve the SPA shell; `/api/*` and search routes are unaffected |
| 3 | `TestFileRead` | 6 | `GET /api/file`: read, missing file, invalid path, returned `mtime`, conditional 304 when unchanged, and fall-through when changed |
| 4 | `TestFileSave` | 6 | `POST /api/file`: create + read back, overwrite, missing parent rejected, traversal rejected, missing fields, and concurrent atomic writes never crash or tear |
| 5 | `TestCreate` | 9 | `/api/create` for files and folders, duplicate conflict, bad `type`, traversal, `upsert` create/idempotent/dir/type-mismatch, and `upsert` must be boolean |
| 6 | `TestMove` | 11 | `/api/move`: rename, into subdir, conflict modes (`error`/`skip`/`overwrite`), missing source, move-onto-itself, move-to-root, symlinked-dir moves the link not the target, and directory overwrite |
| 7 | `TestCopy` | 8 | `/api/copy`: file, recursive dir, conflict modes, copy-onto-itself, copy-to-root, and bad conflict mode |
| 8 | `TestDelete` | 6 | `/api/delete`: file, dir, missing, root rejected, dot-variant paths rejected, and a symlinked dir removes the link not the target |
| 9 | `TestSymlinkedDataDir` | 3 | Path safety when the data dir itself is symlinked: delete-root, clean relative paths from `/api/ls`, and move/copy root rejection |
| 10 | `TestLs` | 5 | `GET /api/ls`: one-folder non-recursive listing of all types, root default, dirs-before-files sort, missing/non-folder paths, and traversal rejection |
| 11 | `TestAppend` | 6 | `POST /api/file/append`: append to existing, accumulation in order, missing file without `create`, `create` flag, missing parent, and traversal/type rejection |
| 12 | `TestEdit` | 14 | `POST /api/edit` ordered batch: append/prepend, literal find_replace count and strict/optional modes, regex backrefs, ignore case, line insert/replace/delete, exactly-one-position rule, all-or-nothing batches, unknown ops, missing file/traversal, and trailing-newline normalization |
| 13 | `TestSearch` | 27 | `/api/search`: case sensitivity, snippet markers, empty query, regex mode and errors, alternation, case flag, single-file scope, glob filter, per-file and total cap overrides, bad caps, `order=path\|mtime\|count` (+ `desc`), and unique mode (one row per note, exact uncapped `count`, first-occurrence `line`/`col`/`snippet`, note `limit`, ignored `perFile`, `perFileTruncated` disclosure, legacy shape without `unique`, and case-distinct paths) |
| 14 | `TestGraph` | 9 | `/api/graph`: all files as nodes, node name + degree, wikilink-by-stem edges, relative markdown-link edges, extensionless wikilinks, self-links dropped, undirected dedup, links to missing files dropped, and anchor fragments stripped |
| 15 | `TestConfig` | 3 | `GET`/`POST /api/config`: default empty, round-trip, and non-object rejection |
| 16 | `TestInfo` | 1 | `GET /api/info` returns the data and config dirs |
| 17 | `TestAuth` | 20 | Two-password auth with both roles set: status shape, login as admin/viewer, admin precedence, wrong/empty password, logout, gating of reads and writes per role, every mutating route, index unauthenticated, and the rate limiter lockout and reset |
| 18 | `TestAuthNoViewer` | 5 | Admin-only auth (no viewer password): status shape, reads require a session, admin reads after login, writes still need admin, and a nonexistent viewer password is rejected |
| 19 | `TestAuthSetPasswords` | 17 | `POST /api/auth/passwords`: admin-only, set/change/clear viewer and admin passwords, current-password requirement, clear-admin also clears the viewer password, password-length rule, first-save rule, no-op clear, and non-string/missing-key rejection |
| 20 | `TestApiTokens` | 13 | `/api/auth/tokens`: token shown exactly once, duplicate-name conflict, validation, refused when auth is off, admin-only, admin token reads/writes without a session, viewer token read-only, invalid token fails hard with no session fallback, non-Bearer ignored, revocation, delete missing, clearing the admin password clears tokens, and the rate limiter applies to bad tokens |
| 21 | `TestAgentGuide` | 6 | `/agent.md`: served as markdown with key sections, old `/agent/` URL falls through to the SPA, `{{auth_state}}` substitution, not cached and no secrets, served while auth is on, and the notice reflects auth state |
| 22 | `TestAiTools` | 7 | `POST /api/ai/fetch` and `/api/ai/search`: fetch body, bad URLs rejected, upstream error becomes 502, search requires a configured instance, search queries the instance, bad query rejected, and both tools are admin-gated when auth is on |
| 23 | `TestAiConfig` | 9 | `GET`/`POST /api/ai/config`: empty default, masked key on round-trip, `replaceSecret` carries the stored key, trailing `/v1` stripped from base URLs, global custom prompt and SearXNG URL round-trips, rename carries the key via `replaceSecretFor`, validation errors, and admin-only when auth is on |
| 24 | `TestAiChat` | 8 | `POST /api/ai/chat` SSE relay: relays frames and forwards the stored key/model, unknown server, message validation, upstream HTTP error becomes an in-band SSE error event, probe unreachable/reachable/unknown-server, and `/api/ai/config` is readable while chat stays gated |

## Real loopback HTTP stubs for the AI tests

The AI proxy tests do not mock `requests`. They start a real
`http.server.HTTPServer` on port 0 (an ephemeral loopback port) in a daemon
thread and point an AI profile at it, so the relay is exercised over a real
socket.

- `_StubOpenAIHandler` (`test_app.py:2277-2323`) stands in for an
  OpenAI-compatible provider. On `POST` it records the request path, the
  `Authorization` header, and the parsed JSON body into the module-level
  `nb.LAST_UPSTREAM` dict, then either returns `nb.UPSTREAM_STATUS` or
  streams a canned SSE completion (`"hello"` + `" world"` + `[DONE]`).
  `TestAiChat` asserts on what the relay actually forwarded.
- `_StubWebHandler` (`test_app.py:2410-2446`) stands in for the fetch and
  search targets. `GET /page` returns a small HTML body, `GET /error`
  returns 500, and `GET /search?q=...&format=json` returns a SearXNG-style
  JSON result list. It records the last request path into `nb.LAST_WEB`.
  `TestAiTools` uses it.

Both handlers override `log_message` to keep test output clean. Each of
`TestAiTools` and `TestAiChat` starts its stub in `setUpClass` and shuts it
down in `tearDownClass`, resetting `LAST_UPSTREAM` / `LAST_WEB` (and
`UPSTREAM_STATUS`) in `setUp`.

## Multi-workspace coverage

`WorkspaceTestBase` (no tests) adds throw-away root folders
(`make_root`), registry/config fixtures (`write_registry`, `write_config`),
a session helper (`set_session_workspace`), a `file_stamp` no-write assertion
(`contents`, `mtime_ns`), an `enable_auth` fixture, a `call` helper, and the
two route tables the resolution and cache tests share
(`DATA_ROUTE_CALLS`, `NON_DATA_ROUTE_CALLS`, `PUBLIC_ROUTE_CALLS`). Eight
classes cover the feature:

| Class | Tests | Covers |
| --- | --- | --- |
| `TestWorkspaceStore` | 16 | Registry load/save: a missing file, a missing default entry and a corrupt file each synthesise the default in memory without writing; persistence is asserted through a mutating route (add, rename) and through `_persist_workspaces_if_changed`; a corrupt registry never 500s, is left byte-identical and warns once across several requests; invalid/duplicate entries dropped, default forced first, a stale stored default path corrected to `DATA_DIR`, 32-entry cap, rename keeps id/path/default flag, duplicate rename rejected, delete removes the entry but keeps files, unknown ids 404, default is not removable |
| `TestWorkspaceValidation` | 16 | `POST /api/workspaces` 400s: missing fields, non-object body, empty/overlong/duplicate name, relative path, missing path, file-not-folder, unreadable folder, path inside `BASE_DIR` or `CONFIG_DIR`, path containing `BASE_DIR`, overlap in both directions (message names the other workspace), 32-entry cap; every one of those asserts its stable `code`; plus the 201 public shape, realpath storage, and symlinked-folder registration |
| `TestWorkspacePermissions` | 11 | Admin may add/rename/remove/write state; a viewer may list and switch but gets 403 `not_admin` on every registry write; anonymous gets 401; auth-off allows loopback and refuses non-loopback writes (overridden `REMOTE_ADDR`) while reads stay open; an `X-Forwarded-For` or `X-Real-IP` header is refused even from loopback with `loopback_required`; logout clears `session["workspace"]` as well as the role; the shell boot always paints `data-workspace` and `data-role` but withholds the workspace list from an anonymous client; the shell does not list workspace names to an anonymous client |
| `TestWorkspaceResolution` | 13 | `X-Notebook-Workspace` selects the tree and `/api/info` root and `active`; an unknown header or a stale session id 404s with `code: unknown_workspace` on the twelve gated data routes only and never on `/api/config`, `/api/info`, `/api/workspaces`, `/api/workspaces/active`, `/api/login`, `/api/auth`, `/api/ai/config` or the shell; unauthenticated callers get 401 for both a real and an unknown id (no id oracle); session switch; header beats session; bad switch ids; removing the active workspace clears the session; shell boot carries the active id and name; a folder deleted after registration is listed as `available: false` and serves an empty tree instead of failing |
| `TestWorkspaceDataIsolation` | 2 | A file written through one root is absent from the default tree, and deleting a same-named file in workspace B leaves the default copy intact |
| `TestWorkspacePathGuards` | 4 | Delete/move/copy of a non-default root refused; delete of the default root refused; `../` traversal refused for delete/move/copy, file write, file read and `ls` in a non-default root and in the default root |
| `TestWorkspaceConfigState` | 12 | The legacy migration runs from `_migrate_config_at_startup`, moving the seven content keys into `workspaceState.default` (persisted, unrelated keys kept) and is idempotent by mtime; `GET /api/config` is read-only and returns the stored shape unchanged; `POST /api/config` folds stray legacy top-level keys into `workspaceState.default` and preserves other workspaces' entries; existing `workspaceState` left alone; empty config untouched; workspace-state merge keeps other entries and unrelated keys; non-object/missing/oversized bodies rejected (400 with `bad_body` / `state_too_large`), the exact cap accepted, and a failed config write is a 500 with `write_failed` |
| `TestWorkspaceCacheHeaders` | 4 | Every gated read carries `Vary: X-Notebook-Workspace` plus `Cache-Control: no-store`; the data-route unknown-workspace 404s vary too, as do the non-data routes that answer an unknown id; `POST /api/workspace-state` varies |

Known gap (reported, not fixed): `POST /api/workspace-state` is gated by the
plain `admin_required` decorator, so its viewer 403 body carries no `code` and
its auth-off path is not loopback-gated the way the three registry mutations
are. `TestWorkspacePermissions` asserts the current 403 only.

## Related documentation

- [`README.md`](README.md) — strategy, run commands, and suite selection.
- [`frontend.md`](frontend.md) — the DOM and browser suites.
- [`../architecture/backend.md`](../architecture/backend.md) — the backend
  architecture these tests cover.
- [`../contracts/http-api.md`](../contracts/http-api.md) — the endpoint
  reference.
