# Backend test suite

`tests/test_app.py` is 8,116 lines of stdlib `unittest`. It drives the real
Flask app through Flask's test client, so every test exercises the real
routing, decorators, path resolution, and write path.

The suite currently holds **556 test methods across 53 test-bearing classes**.
The file has 56 `class` statements; four of them hold no tests: the shared
bases `BaseTest` and `WorkspaceTestBase`, and the two loopback stubs
`_StubOpenAIHandler` and `_StubWebHandler`. The first table below maps the core
route/file classes; the second accounts for every other class, so the two tables
sum to the 556 total. Workspace coverage has its own table in the
multi-workspace section.

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
directory **before** it imports `app` (the module-level `_TMP` /
`os.environ` block in `tests/test_app.py`), then puts the project root on
`sys.path` and imports `app as nb`. The project's real `notebook/` and
`config/` are never touched.

`BaseTest.setUp` resets that temp environment between tests: it removes
`nb.DATA_DIR` and `nb.CONFIG_DIR` if present, calls `nb.seed()` to recreate
`notebook/Welcome.md` and `config/config.json` (`{}`), and builds a fresh
`nb.app.test_client()`. It also provides two helpers, `post(path, body)` and
`jget(path)`, used throughout.

The auth-aware classes call `super().setUp()` and then reset the in-memory
login rate limiter with `nb._login_failures.clear()` (for example
`TestAuth.setUp`), so a test that intentionally trips the five-failure lockout
does not lock out the next test's client IP. `TestAuth` and the other auth
classes then write their own `config/auth.json` with bcrypt-hashed passwords at
a low cost factor so tests stay fast.

## TestCase classes

| # | Class | Tests | Covers |
| --- | --- | --- | --- |
| 1 | `TestIndexAndSeed` | 22 | `GET /` HTML, first-paint boot state (sanitizing hostile config, clamping pane widths, not leaking content, defaults until authenticated, painting the saved active view and falling back to explorer for a bad one), the active-view allowlist matching the registry and the DOM, SPA catch-all boot state, seeding `Welcome.md` + empty config, seeded tree, and `Cache-Control: no-store` (plus an empty 401 body) on gated reads |
| 2 | `TestSpaCatchAll` | 6 | Root, file-path, subfolder, and deep-link-with-fragment requests serve the SPA shell; `/api/*` and search routes are unaffected |
| 3 | `TestWebAppManifest` | 4 | The iOS web-clip paths (`/apple-touch-icon.png`, `-precomposed`) and the v2 PNG icons are served as real PNGs, not the SPA shell; the shell links the v2 icon and theme colour; `manifest.json` declares `/` scope, standalone display, and the 192/512 v2 icons |
| 4 | `TestFileRead` | 6 | `GET /api/file`: read, missing file, invalid path, returned `mtime`, conditional 304 when unchanged, and fall-through when changed |
| 5 | `TestFileSave` | 6 | `POST /api/file`: create + read back, overwrite, missing parent rejected, traversal rejected, missing fields, and concurrent atomic writes never crash or tear |
| 6 | `TestCreate` | 9 | `/api/create` for files and folders, duplicate conflict, bad `type`, traversal, `upsert` create/idempotent/dir/type-mismatch, and `upsert` must be boolean |
| 7 | `TestMove` | 16 | `/api/move`: rename, into subdir, conflict modes (`error`/`skip`/`overwrite`), missing source, move-onto-itself, move-to-root, symlinked-dir moves the link not the target, and directory overwrite |
| 8 | `TestCopy` | 12 | `/api/copy`: file, recursive dir, conflict modes, copy-onto-itself, copy-to-root, and bad conflict mode |
| 9 | `TestDelete` | 6 | `/api/delete`: file, dir, missing, root rejected, dot-variant paths rejected, and a symlinked dir removes the link not the target |
| 10 | `TestSymlinkedDataDir` | 3 | Path safety when the data dir itself is symlinked: delete-root, clean relative paths from `/api/ls`, and move/copy root rejection |
| 11 | `TestLs` | 5 | `GET /api/ls`: one-folder non-recursive listing of all types, root default, dirs-before-files sort, missing/non-folder paths, and traversal rejection |
| 12 | `TestAppend` | 6 | `POST /api/file/append`: append to existing, accumulation in order, missing file without `create`, `create` flag, missing parent, and traversal/type rejection |
| 13 | `TestEdit` | 14 | `POST /api/edit` ordered batch: append/prepend, literal find_replace count and strict/optional modes, regex backrefs, ignore case, line insert/replace/delete, exactly-one-position rule, all-or-nothing batches, unknown ops, missing file/traversal, and trailing-newline normalization |
| 14 | `TestSearch` | 35 | `/api/search`: case sensitivity, snippet markers, empty query, regex mode and errors, alternation, case flag, single-file scope and its bad input, glob filter, per-file and total cap overrides, bad caps, hidden directories skipped, `order=path\|mtime\|count` (+ `desc`, invalid rejected), the `name=` basename mode (basename not content, case/regex, `limit` + truncation, order, glob and file scope, absent keeps a content search, invalid input rejected), and unique mode (one row per note, exact uncapped `count`, two hits on one line, first-occurrence `line`/`col`/`snippet`, note `limit`, ignored `perFile`, `perFileTruncated` disclosure, legacy shape without `unique`, and case-distinct paths) |
| 15 | `TestGraph` | 15 | `/api/graph`: all files as nodes, node name + degree, same-folder wikilink edges, `[[Target|label]]` edges, relative markdown-link edges (including from a subfolder), extensionless wikilinks, a relative path to a sibling in every form (`./sib`, `sib`, `/notes/sib`, `sib.md`), a root target resolving from a subfolder, a bare name never resolving outside its folder, root and root-escaping targets, self-links dropped, undirected dedup, links to missing files dropped, and anchor fragments stripped |
| 16 | `TestConfig` | 3 | `GET`/`POST /api/config`: default empty, round-trip, and non-object rejection |
| 17 | `TestInfo` | 1 | `GET /api/info` returns the data and config dirs |
| 18 | `TestAuth` | 20 | Two-password auth with both roles set: status shape, login as admin/viewer, admin precedence, wrong/empty password, logout, gating of reads and writes per role, every mutating route, index unauthenticated, and the rate limiter lockout and reset |
| 19 | `TestAuthNoViewer` | 5 | Admin-only auth (no viewer password): status shape, reads require a session, admin reads after login, writes still need admin, and a nonexistent viewer password is rejected |
| 20 | `TestAuthSetPasswords` | 17 | `POST /api/auth/passwords`: admin-only, set/change/clear viewer and admin passwords, current-password requirement, clear-admin also clears the viewer password, password-length rule, first-save rule, no-op clear, and non-string/missing-key rejection |
| 21 | `TestApiTokens` | 13 | `/api/auth/tokens`: token shown exactly once, duplicate-name conflict, validation, refused when auth is off, admin-only, admin token reads/writes without a session, viewer token read-only, invalid token fails hard with no session fallback, non-Bearer ignored, revocation, delete missing, clearing the admin password clears tokens, and the rate limiter applies to bad tokens |
| 22 | `TestAgentGuide` | 6 | `/agent.md`: served as markdown with key sections, old `/agent/` URL falls through to the SPA, `{{auth_state}}` substitution, not cached and no secrets, served while auth is on, and the notice reflects auth state |
| 23 | `TestAiTools` | 13 | `POST /api/ai/fetch` and `/api/ai/search`: fetch body, bad URLs rejected, upstream error becomes 502, search falls back to the Yahoo results page when unconfigured or when SearXNG fails, an empty results page is 200 with no results, non-http result targets skipped, sponsored Bing click trackers skipped, an unexpected SearXNG JSON shape falling back, 502 only when both fail, search queries the instance, bad query rejected, and both tools are admin-gated when auth is on |
| 24 | `TestAiConfig` | 9 | `GET`/`POST /api/ai/config`: empty default, masked key on round-trip, `replaceSecret` carries the stored key, trailing `/v1` stripped from base URLs, global custom prompt and SearXNG URL round-trips, rename carries the key via `replaceSecretFor`, validation errors, and admin-only when auth is on |
| 25 | `TestAiChat` | 15 | `POST /api/ai/chat` SSE relay: relays frames and forwards the stored key/model, the message-part array (accepted, bad parts rejected, the eight-image cap, per-message extra keys stripped, an image send writes no file), the 32 MiB body cap returning JSON 413, unknown server, message validation, upstream HTTP error becomes an in-band SSE error event, probe unreachable/reachable/unknown-server, `/api/ai/config` readable while chat stays gated, and an ACP name collision routing to the OpenAI profile |
| 26 | `TestPathHelpers` | 4 | `_same_file_ignoring_case` and `_is_within`: a symlink and its target are two entries, a hard-link pair with case-variant names is one file, `_is_within` ignores a shared path prefix, and it follows a symlinked source |

The remaining 235 tests live in 19 classes that round out the suite:

| Class | Tests | Covers |
| --- | --- | --- |
| `TestScanTimeout` | 4 | The search and graph scans run under a wall-clock deadline: a timed-out scan is reported as such in every search mode, and `/api/graph` answers 504 |
| `TestAcpConfig` | 25 | `config/acp.json`: the three accepted shapes, per-entry validation and drop rules, duplicate names keeping the first, an `ai.json` name collision dropping the ACP entry, masked `acps`/`acp` exposure, default resolution, a POST `default` naming an ACP profile and a colliding server name rejected, agent-key resolution and fail-closed unknowns, the agent/command exclusivity rules, model bounds, and the read-only agent detection |
| `TestAcpChat` | 36 | `POST /api/ai/chat` through the ACP branch against a stub agent: streamed deltas, a tool-call trace frame, the flattened preamble, validation, model negotiation, environment inheritance, permission auto-allow, client-bound capabilities refused, reaping on EOF/timeout/crash, and the image path (block shape and order, tool follow-up, invalid/oversized images 400, the no-capability and null-capability cases, a 3 MiB image through stdio) |
| `TestAcpClient` | 14 | Direct unit tests for `acp_client.run_turn` with no Flask app: exactly one terminal event per turn, dead agent, timeout, version mismatch, model negotiation, image blocks after the text block, null capabilities, and the elicitation override |
| `TestSeedMigration` | 5 | `seed()`: the legacy `data/` migration (source dropped only when emptied), template/bootstrap branches, and idempotence when a config already exists |
| `TestBackendHelperBranches` | 17 | Direct unit coverage for helper error/edge branches: `safe_path`, `expect_json`, `build_tree`, boot-state clamping, config parsing, SSE joining, token lookup, stored-hash checks, and logout with auth off |
| `TestEditValidationBranches` | 2 | Every `_EditError` validation branch in the patch engine leaves the file untouched; `text_to_lines` drops a trailing empty part |
| `TestConfigAndPasswordErrors` | 3 | A config write failure is a 500; the password endpoint rejects a missing field and a non-string current password |
| `TestAuthLoginValidation` | 1 | Login body validation behind the auth-enabled check |
| `TestAcpConfigBranches` | 2 | The `load_acp_config()` compatibility wrapper: defaults for `args`/`cwd`, and an `env` that is not an object rejecting the entry |
| `TestAiConfigErrorPaths` | 6 | The `/api/ai/config` validation table, save failure, the masked view, and `replaceSecret` across all stored servers |
| `TestAiUpstreamErrorPaths` | 8 | Failure paths in probe / fetch / search / chat: bad base URLs, connection errors, non-JSON and mixed search results, and a chat connection failure as an in-band SSE error |
| `TestAcpChatErrorPaths` | 5 | ACP SSE validation and disconnect paths: oversize prompt, corrupt config preamble, client disconnect, and an empty stream closing cleanly |
| `TestRouteErrorPaths` | 14 | `OSError`/bad-input branches in the file, `ls`, search and graph routes, including entries that vanish mid-scan and unreadable notes |
| `TestMoveCopyDeleteErrorPaths` | 10 | Conflict, race and `OSError` branches in move/copy/delete: lost races as 409, rename fallback without hardlinks, and partial-write cleanup |
| `TestAcpClientExtra` | 8 | The remaining `acp_client` paths: session updates, permission preference, all capability overrides, queue overflow, and generator close cancelling the turn |
| `TestCliUnit` | 5 | `parse_args`, `reachable_urls`, and `_lan_ipv4_addresses` without running the server |
| `TestMainEntrypoint` | 1 | The `__main__` block with `Flask.run` stubbed out |
| `TestWorkspace*` (8 classes) | 83 | Multi-workspace coverage; see the table in the multi-workspace section |

## Real loopback HTTP stubs for the AI tests

The AI proxy tests do not mock `requests`. They start a real
`http.server.HTTPServer` on port 0 (an ephemeral loopback port) in a daemon
thread and point an AI profile at it, so the relay is exercised over a real
socket.

- `_StubOpenAIHandler` stands in for an
  OpenAI-compatible provider. On `POST` it records the request path, the
  `Authorization` header, and the parsed JSON body into the module-level
  `nb.LAST_UPSTREAM` dict, then either returns `nb.UPSTREAM_STATUS` or
  streams a canned SSE completion (`"hello"` + `" world"` + `[DONE]`).
  `TestAiChat` asserts on what the relay actually forwarded.
- `_StubWebHandler` stands in for the fetch and
  search targets. `GET /page` returns a small HTML body, `GET /error`
  returns 500, `GET /search?q=...&format=json` returns a SearXNG-style
  JSON result list, `GET /search-array` a JSON array, `GET /results`
  returns a two-result Yahoo results page
  for the fallback, `GET /results-empty` a page with no result titles, and
  `GET /results-unsafe` a page whose targets are `javascript:` and
  `mailto:` URLs plus one http URL, and `GET /results-ad` a page whose
  first block is a Bing sponsored click tracker. It records the last
  request path into `nb.LAST_WEB`. `TestAiTools` uses it.

Both handlers override `log_message` to keep test output clean. Each of
`TestAiTools` and `TestAiChat` starts its stub in `setUpClass` and shuts it
down in `tearDownClass`, resetting `LAST_UPSTREAM` / `LAST_WEB` (and
`UPSTREAM_STATUS`) in `setUp`.

## Multi-workspace coverage

`WorkspaceTestBase` (no tests) adds throw-away root folders
(`make_root`), registry/config fixtures (`write_registry`, `write_config`),
a session helper (`set_session_workspace`), a `file_stamp` no-write assertion
(`contents`, `mtime_ns`), an `enable_auth` fixture, a `call` helper, and the
three route tables the resolution and cache tests share (`DATA_ROUTE_CALLS`
for the twelve gated data routes, `NON_DATA_ROUTE_CALLS` for the
shell/auth/registry-level routes that must not 404 on an unknown id, and
`PUBLIC_ROUTE_CALLS` for the routes that answer any caller). Ten classes
cover the feature:

| Class | Tests | Covers |
| --- | --- | --- |
| `TestWorkspaceStore` | 16 | Registry load/save: a missing file, a missing default entry and a corrupt file each synthesise the default in memory without writing; persistence is asserted through a mutating route (add, rename) and through `_persist_workspaces_if_changed`; a corrupt registry never 500s, is left byte-identical and warns once across several requests; invalid/duplicate entries dropped, default forced first, a stale stored default path corrected to `DATA_DIR`, 32-entry cap, rename keeps id/path/default flag, duplicate rename rejected, delete removes the entry but keeps files, unknown ids 404, default is not removable |
| `TestWorkspaceValidation` | 16 | `POST /api/workspaces` 400s: missing fields, non-object body, empty/overlong/duplicate name, relative path, missing path, file-not-folder, unreadable folder, path inside `BASE_DIR` or `CONFIG_DIR`, path containing `BASE_DIR`, overlap in both directions (message names the other workspace), 32-entry cap; every one of those asserts its stable `code`; plus the 201 public shape, realpath storage, and symlinked-folder registration |
| `TestWorkspacePermissions` | 11 | Admin may add/rename/remove/write state; a viewer may list and switch but gets 403 `not_admin` on every registry write; anonymous gets 401; auth-off allows loopback and refuses non-loopback writes (overridden `REMOTE_ADDR`) while reads stay open; an `X-Forwarded-For` or `X-Real-IP` header is refused even from loopback with `loopback_required`; logout clears `session["workspace"]` as well as the role; the shell boot always paints `data-workspace` and `data-role` but withholds the workspace list from an anonymous client; the shell does not list workspace names to an anonymous client |
| `TestWorkspaceResolution` | 13 | `X-Notebook-Workspace` selects the tree and `/api/info` root and `active`; an unknown header or a stale session id 404s with `code: unknown_workspace` on the twelve gated data routes only and never on `/api/config`, `/api/info`, `/api/workspaces`, `/api/workspaces/active`, `/api/login`, `/api/auth`, `/api/ai/config` or the shell; unauthenticated callers get 401 for both a real and an unknown id (no id oracle); session switch; header beats session; bad switch ids; removing the active workspace clears the session; shell boot carries the active id and name; a folder deleted after registration is listed as `available: false` and serves an empty tree instead of failing |
| `TestWorkspaceDataIsolation` | 2 | A file written through one root is absent from the default tree, and deleting a same-named file in workspace B leaves the default copy intact |
| `TestWorkspacePathGuards` | 4 | Delete/move/copy of a non-default root refused; delete of the default root refused; `../` traversal refused for delete/move/copy, file write, file read and `ls` in a non-default root and in the default root |
| `TestWorkspaceConfigState` | 17 | The legacy migration runs from `_migrate_config_at_startup`, moving the seven content keys into `workspaceState.default` (persisted, unrelated keys kept) and is idempotent by mtime; `GET /api/config` is read-only and returns the stored shape unchanged; workspace-state write keeps other entries and unrelated keys; non-object/missing/oversized bodies rejected (400 with `bad_body` / `state_too_large`), the exact cap accepted, and a failed config write is a 500 with `write_failed`. **Must change with sync §17.2:** the existing folding assertions (`tests/test_app.py:6853`, `:6876`) become assertions that `POST /api/config` strips `workspaceState`, `workspaceStateRev` and every scoped key and re-attaches the stored maps, and that a corrupt read refuses with 500 `write_failed`. The class asserts the *opposite* today, so the sync change cannot land without editing it. |
| `TestWorkspaceStateSync` | 21 | Sync §17.2. `GET /api/workspace-state` returns `{ok, id, rev, state}`; **304 with an empty body** when `rev` equals the stored rev; `state: {}` and `rev: 0` for an entry never written; 400 `bad_body` without an `id`; 404 `unknown_workspace`; `POST` with `base` equal to the stored entry stores `state` verbatim and answers the **new** rev and the stored state; a stale `base` merges per session (both sides' changes survive, a same-session edit takes the client's copy, a delete applies only to an untouched session, an add from either side survives); a replay is idempotent but still bumps the rev; a missing `base` is 400 `bad_body` and writes nothing; the rev is monotonic across a `POST /api/config` (never regresses); deleting a workspace removes its state entry and rev; a viewer may GET and is refused POST; the 304 and the 200 both carry `no-store` and `Vary`; a `base` over `WORKSPACE_STATE_MAX_BYTES` is 400 `base_too_large` with nothing written, and that check runs **before** the workspace lookup (an unknown id with an oversized base is 400, not 404); a `state` under the cap whose merged result exceeds it is 400 `state_too_large` with nothing written, leaving the entry and the rev as they were. |
| `TestWorkspaceStateMerge` | 18 | The pure merge (no HTTP): `_session_key` ignores `activeFile` and a non-list `openFiles`; every three-way rule (add from either side, same-session edit, delete untouched, resurrect a server-changed delete, peer-only session, order); the list-field rule; replay idempotence; non-dict and malformed inputs (a non-list `sessions` never raises); unusable and duplicate entries; `_workspace_state_rev` for missing, non-int, negative, bool and non-dict maps. |
| `TestWorkspaceCacheHeaders` | 4 | Every gated read carries `Vary: X-Notebook-Workspace` plus `Cache-Control: no-store`; the data-route unknown-workspace 404s vary too, as do the non-data routes that answer an unknown id; `POST /api/workspace-state` varies |

`POST /api/workspace-state` (`set_workspace_state`) is gated by
`workspace_admin_required`, the same wrapper as the three registry mutations.
So a viewer's 403 carries `code: not_admin`, and with auth off the route
accepts a loopback peer only and refuses a request that carries any
`PROXY_FORWARD_HEADERS` value (`code: loopback_required`). The earlier version
of this section recorded the opposite; that described the old
`admin_required` gate, which the route no longer uses.

`TestWorkspaceStateSync` and `TestWorkspaceStateMerge` are the contract for the
cross-device read/write pair ([`architecture/sessions.md`](../architecture/sessions.md)
§17.2). Three rules they pin that are easy to lose in a refactor: a 304 carries
no body, no route accepts a client-supplied `workspaceStateRev` (so a rev can
never move backwards), and a stale write is **merged**, never rejected — a
conflict status was designed out because it made the loser's own change vanish.
The "fold stray legacy keys on POST" assertion now lives on
`_migrate_config_at_startup`; `TestWorkspaceConfigState` asserts the inverted
rule, that a whole-blob POST strips the state and re-attaches the stored maps.

Residual test gap: no auth-off case asserts the loopback refusal on
`/api/workspace-state` (the refusal cases cover only the three registry
mutations; the workspace-state calls in `TestWorkspaceConfigState` run with
auth off from loopback and are therefore allowed). The viewer refusal on the
same route does assert `not_admin`.

## Related documentation

- [`README.md`](README.md) — strategy, run commands, and suite selection.
- [`frontend.md`](frontend.md) — the DOM and browser suites.
- [`../architecture/backend.md`](../architecture/backend.md) — the backend
  architecture these tests cover.
- [`../contracts/http-api.md`](../contracts/http-api.md) — the endpoint
  reference.
