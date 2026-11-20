# Configuration guidelines

Rules for where a setting lives, who may write it, and how it is stored. Read
with [`configuration.md`](configuration.md), which documents every key that
exists today. This file is the decision rulebook: follow it before inventing a
seventh config file.

## The six files

| File | Owner | Written by | Browser-writable |
| --- | --- | --- | --- |
| `config.json` | the page | `POST /api/config` (`app.py`) | yes: preferences only |
| `state.json` | server | `POST /api/workspace-state`, `DELETE /api/workspaces/<id>`, the startup split and quarantine | no |
| `auth.json` | server | the security routes and `ensure_auth_secret()` | never through a config blob |
| `ai.json` | server, hand-editable | `POST /api/ai/config`, `_migrate_acp_file()` | yes: servers, and the allowlisted ACP subset |
| `workspaces.json` | server, hand-editable | the workspace routes, `_persist_workspaces_if_changed()` | no |
| `server.json` | human | hand edit only, read at startup | no |

`config/` is runtime state: the whole folder is git-ignored. A file that does
not exist must be a valid state, never an error (`state.json`, `server.json`,
`ai.json`). A file a human is expected to edit ships a documented example in
`config.template/`, and the example is tested so it cannot rot.

## Where a new value goes

First match wins. If nothing matches, report the gap instead of adding a file.

1. **Is it a secret** (password, token, provider key, agent credential)? Go to
   `auth.json`, or to the entry that needs it in `ai.json`. Never `config.json`
   and never `state.json`.
2. **Does it choose something the server executes, or a folder it touches**
   (a command, an argv, a filesystem root, an environment overlay)? It is not
   browser-writable in free form. Two shapes are allowed: hand-edited and read
   by the server (`server.json`, the `command` escape hatch in `ai.json`), or
   browser-writable but restricted to a server-side allowlist (an ACP `agent`
   key), and then gated to a loopback peer while auth is off.
3. **Is it per-workspace, content-bearing state** (open tabs, sessions, pins,
   bookmarks, recents, active file)? Go to `state.json`, written only through
   `POST /api/workspace-state`. Content-bearing means "one device's view of the
   work", which another device may have changed.
4. **Is it a UI preference** the page may change at any time (theme, widths,
   toggles, vim settings, search defaults)? Go to `config.json`.
5. **Is it a process or startup value** (bind address, port, debug)? Go to
   `server.json`. Install paths are not config: they are env vars
   (`NOTEBOOK_DATA_DIR`, `NOTEBOOK_CONFIG_DIR`), because tests must point them
   at a temp dir before the module is imported.
6. **None of these?** Stop and ask. Do not put it in `config.json` "for now";
   a preference that is actually server-owned is how one device starts
   clobbering another.

## Naming

- **File names** are one lowercase word plus `.json` (`config`, `state`,
  `server`, `auth`, `workspaces`). The folder already scopes the name, so
  `workspace_state.json` and `config_settings.json` are wrong.
- **On disk** a nested name is `snake_case` (`base_url`, `custom_prompt`,
  `searxng_url`). **On the wire** it is `camelCase` (`baseUrl`,
  `customPrompt`). A new file picks one and stays with it.
- **Server-owned keys keep their wire name when the file moves.** The state
  maps are `workspaceState` / `workspaceStateRev` in the API even though they
  live in `state.json`, because the client contract outlives the layout
  (`get_config`, `app.js`).
- **A file that may change shape carries `version`** (`state.json`,
  `workspaces.json`). An unknown version is not guessed at: it is quarantined
  (`state.json`) or ignored, and said so in the docs.
- **Never let the shape of a response depend on whether data exists.**
  `GET /api/config` always emits both state maps, `{}` when empty, so the
  reader has one shape (`get_config`, `app.py`).

## Reading

- **Validate on every read.** A hand-edited file is untrusted input: check the
  JSON type, then each field's type, length and range, and an allowlist where
  one exists (`load_server_config`, `_validate_acp_profile`, `load_workspaces`).
  An invalid *entry* is dropped individually; an invalid *document* is not
  half-read.
- **Two readers, two policies.** A GET uses the never-raising reader
  (`_read_public_config`, `_read_public_state`); a read-modify-write uses the
  strict one (`_read_stored_config`, `_read_stored_state`) so a parse failure
  cannot be turned into "empty" and written back.
- **Absent means one thing per file, and it is documented.** `server.json`: use
  the built-in default. `POST /api/ai/config`: keep what is stored
  (`customPrompt`, `searxngUrl`, `acp`). Where clearing is meaningful, `""`
  clears it. Do not mix these three in one file.
- **Normalise on read, not by writing.** An orphan revision, a padded name or a
  bad port is fixed in the returned value or rejected; a GET never repairs a
  file (`_read_stored_state` drops a rev with no state entry).

## Writing

- Every write goes through `atomic_write()`: unique temp name, then
  `os.replace`. A reader never sees a partial document.
- **One lock per file.** `_CONFIG_LOCK` for `config.json`, `_STATE_LOCK` for
  `state.json`. Lock order is `_CONFIG_LOCK` then `_STATE_LOCK`; only the
  startup split takes both. Never take them in the other order.
- **A failed write is reported, not swallowed.** A route answers 500
  `write_failed` with the reason; a startup step logs and leaves both files for
  the next launch. Never claim success for a write that failed
  (`_migrate_state_out_of_config`).
- **Only startup maintenance and the mutating routes write.** A route that
  reads must not migrate, or a page refresh becomes a write.
- A malformed file is never repaired by the next write: it is refused, or
  renamed aside at startup with a timestamp (`_quarantine_bad_state_file`), and
  the document says which.

## Secrets

| Rule | Why |
| --- | --- |
| A secret never sits in `config.json` or `state.json` | both are reachable from a client blob or a poll |
| A secret is never echoed: a boolean `hasKey`, or `apiKey: ""` + `replaceSecret: true` | a captured config response cannot be replayed (`_sanitize_server`) |
| Passwords are bcrypt, cost 12 | `auth.json` only |
| Cleartext is allowed only where the value must be used verbatim (upstream provider keys, ACP `env`) | and the doc says so, with the file-permission caveat |
| An archived or migrated file keeps its secrets | `acp.json.migrated` still holds every `env` value; say it out loud in the migration note |

## Who may write, with auth off

With auth on, the route's role decides. With auth off every route is open to
the LAN, so a file whose content widens the server's authority additionally
requires a loopback peer with no `X-Forwarded-For` / `X-Real-IP` header, tested
with `is not None` so an empty forwarded header still counts as a proxy.

| Write | Auth on | Auth off |
| --- | --- | --- |
| `POST /api/config` (preferences) | admin | open |
| `POST /api/workspace-state` | workspace admin | loopback, no forwarding header |
| `POST /api/ai/config` (`servers`) | admin | open |
| `POST /api/ai/config` (`acp`) | admin | loopback, no forwarding header |
| workspace registry mutations | workspace admin | loopback, no forwarding header |
| `server.json` | — | hand edit only |

A same-host reverse proxy dials in from `127.0.0.1`, so a proxy that strips
both headers is indistinguishable from a local client. Say that as a deployment
condition; do not claim the rule is airtight.

## Migrations

- **One-shot, at import, before the server binds** (`seed()`,
  `_migrate_config_at_startup()`, `_quarantine_bad_state_file()`,
  `_migrate_state_out_of_config()`, `_migrate_acp_file()`).
- **Order matters.** Fold legacy keys first, then move them; a fold that runs
  after a move writes to a file nobody reads.
- **Copy raw data, never loader output.** An ACP entry stores `agent`; the
  loader resolves it to a command. Writing the resolved form back adds a
  `command` that the next read rejects.
- **Key the guard on the file, not on memory or on "looks empty".** A module
  flag survives the test suite's per-case `CONFIG_DIR` wipe; a non-empty list
  re-imports a profile set the user deliberately emptied.
- **Never lose the newer copy.** Merge by record with a revision
  (`_newer_state` keeps the higher rev per workspace), and never overwrite an
  existing archive (`acp.json.migrated.1`).
- **Leave the old file behind under a dead name**, log one line, and add at
  most one startup banner note.
- **A crash must leave both files readable.** Write the new file first, strip
  the old one second (`_migrate_state_out_of_config`).

## Adding a setting: checklist

1. It falls in exactly one row of "Where a new value goes".
2. It has a default, and "absent" has one documented meaning.
3. It is validated on read, with a reason for each bound.
4. Its write path is one route or one startup step, under the right lock.
5. A browser cannot reach it if it widens the server's authority.
6. If it is per-workspace, it is in `state.json` and not in `config.json`.
7. The docs are updated in the same change: its key table in
   `configuration.md`, its route row in `http-api.md`, its `DEFAULTS` entry in
   `static/js/app.js` if the page has to fall back, and its test in
   `tests/test_app.py`.

## Anti-patterns

| Do not | What it costs |
| --- | --- |
| Put server-owned state in the client-posted blob | a stale tab overwrites another device's sessions; needs a strip-and-re-attach dance in every write route |
| Let a POST choose a command, an argv or an `env` | remote code execution with the server's privileges |
| Copy a name-keyed field (`env`, `cwd`) onto an entry whose agent changed | a credential scoped to one binary follows the name onto another |
| Give one file two readers with different repair policies | a GET reports empty while a write refuses, and the user loses the difference |
| Store the same value in two files | the copies drift and two writers fight; derive a mirror in the response instead, as `GET /api/config` does for the state maps |
| Make the response shape depend on file contents | three shapes to test, and a client that must guess |
| Warn once from a module flag | the test suite wipes the folder per case, so the warning lands in whichever test runs first |
| Seed a file whose values a flag may contradict | the file records a host the user never chose |
| Fall back to defaults on a malformed startup file | a typo silently binds `0.0.0.0` |
