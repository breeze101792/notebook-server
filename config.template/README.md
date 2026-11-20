# config.template

Reference copies of the settings files a human edits. `config/` itself is
git-ignored runtime state, so the examples live here and nothing is copied
automatically.

| Example | Copy to | Who writes the real file |
| --- | --- | --- |
| `server.json.example` | `config/server.json` | you, by hand; read once at startup |
| `ai.json.example` | `config/ai.json` | Settings → AI, plus hand edits for `env`, `args`, `cwd`, `timeout` and a `command` entry |

Both files document every key inside a `_comment` / `_fields` block. The server
ignores those keys, so an example can be copied as-is.

```bash
cp config.template/server.json.example config/server.json
cp config.template/ai.json.example     config/ai.json     # merge by hand if the file exists
```

## Not here, on purpose

| File | Why no example |
| --- | --- |
| `config/config.json` | the page owns it: `POST /api/config` writes the whole preference blob, and the defaults live in `static/js/app.js`. Hand-editing works, but a copyable example would drift from those defaults. |
| `config/state.json` | server-owned. It is created by the first state write and shaped by the startup split; an example would only invite pasting over a live session. |
| `config/auth.json` | holds the session secret and bcrypt password hashes. An example would mean inventing a hash that must never be copied. The recovery procedure is in `docs/contracts/configuration.md`. |
| `config/workspaces.json` | server-owned registry, rebuilt at startup when it is stale or missing. Add workspaces from the app. |

## Rules for a new hand-edited file

`docs/contracts/config-guidelines.md` decides whether a setting belongs in a
file at all, and which one. `docs/contracts/configuration.md` is the reference
for every key that already exists.
