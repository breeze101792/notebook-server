# Feature: ACP provider — external coding agents in the AI assistant

**Author:** product-designer
**Date:** 2026-10-13
**Status:** Product definition and post-build validation of a delivered feature.
No technical or visual design chosen here. Written after the build; it states the
intent the build was meant to serve and whether the delivered behaviour serves it.
**Inputs:** `acp_client.py` (`ACP_PROTOCOL_VERSION`,
`ACP_TURN_TIMEOUT_DEFAULT`, `run_turn`, `_model_option`); `app.py` (`ACP_FILE`,
`ACP_KNOWN_AGENTS`, `ACP_CONTEXT_PREAMBLE`, `load_acp_configs`,
`load_acp_config`, `_acp_profile`, `_resolve_default_provider`,
`_detect_acp_agents`, `_public_acp_configs`, `_flatten_acp_prompt`,
`_acp_context_preamble`, `_acp_chat_response`, `ai_chat`, `ai_probe`);
`static/js/ai.js` (`loadAiConfig`, the provider picker, `runToolLoop`, the ACP
trace renderer); `static/js/api.js` (`aiChat`); `static/js/settings.js`
(`buildAcpAgentLines`, `buildAiAcpSection`, `buildAiAcpProfile`,
`buildAiAcpInfoRow`, `commitAiProviders`); `config/acp.json`
and `config/acp.json.example`; `tests/test_app.py` (`TestAcpConfig`,
`TestAcpChat`, `TestAcpClient`, `TestAcpConfigBranches`,
`TestAcpChatErrorPaths`, `TestAcpClientExtra`); `tests/dom/test_dom.js` (the
`acp provider` block); `tests/fixtures/stub_acp_agent.py`; `PLAN.md`;
`docs/architecture/acp-provider-review.md`.

---

## 0. One-line definition

Let the notebook's ✨ panel drive an **Agent Client Protocol (ACP)** coding agent
that is already installed on the host (`opencode acp`, Gemini CLI, Claude Code,
Goose, …): the backend launches it as a subprocess, sends one flattened prompt,
and streams its prose back into the same assistant bubble and the same provider
picker.

---

## 1. Intent and scope — who, what job, and why ACP

### 1.1 Who

The same single user the rest of the project serves: an embedded engineer running
a personal, single-user notebook server, signed in as admin. One owner, one host,
one browser. Not a team, not a multi-tenant service.

### 1.2 The job

The owner already uses a coding agent on the host. The job this feature does is:
**point the notebook's existing assistant panel at that agent, so its answers land
in the same chat panel as the OpenAI-compatible models — without rebuilding the
agent's tool loop inside the notebook.**

The motivating work is agentic: read the repo, find the file, propose or make an
edit. An OpenAI-compatible endpoint can only do the notebook's six `nb-tool`
operations because the notebook executes them and asks the user to approve cards.
An ACP agent arrives with its own richer tool set (shell, search, file edit) and
its own permission model, already configured on the host.

### 1.3 Why ACP versus just another OpenAI-compatible endpoint

| | OpenAI-compatible profile | ACP profile |
|---|---|---|
| What it is | A text-in / text-out model endpoint | A subprocess the notebook drives over stdio |
| Tools | The notebook's six tools, executed by the notebook, gated by Apply/Reject cards | The agent's own tools, executed by the agent |
| Context | The notebook owns the transcript and replays it every turn | Same replay, but the agent runs as a fresh process per turn |
| Config | `config/ai.json`, editable in Settings → AI | Hand-edited `config/acp.json`, shown read-only in Settings → AI |

ACP is the right choice when the thing the owner wants is *the agent they already
use*, not a second model. It is the wrong choice when the owner expects the
notebook's safety model (per-action approval, `safe_path`) to apply — see §9(c).

### 1.4 Stated success shape

The user's framing was "the same thing we did for the single model" — **one
picker, one panel, one stream** — but deliberately **not** the same execution
model: the notebook does not execute the agent's tools. This distinction is the
center of the validation in §9.

---

## 2. User goals

- **G1 — Use the agent I already run.** Pick the ACP agent in the same ✨ picker
  and type a request, without a new panel, a new login, or a second client.
- **G2 — Get the agent's real answer.** The agent reads whatever it needs on its
  own and returns prose; the owner does not have to paste file contents in.
- **G3 — Keep the notebook's conversation flow.** The same transcript, the same
  Regenerate / Edit / Clear controls, the same Stop button.
- **G4 — Keep the trust boundary explicit.** The agent's power (filesystem access)
  is the operator's choice via the launcher, not something the notebook hides or
  silently grants through a client-POSTable config.

---

## 3. Scope

**Delivered (MVP).**

- A second provider type, ACP, surfaced in the existing picker as one entry per
  configured profile.
- Hand-edited `config/acp.json` holding one or more profiles, each with `name`,
  `agent`, `command`, `args`, `cwd`, `env`, `model`, `default`, `timeout`.
  `agent` names an entry in the server-side allowlist (`ACP_KNOWN_AGENTS`) and is
  mutually exclusive with `command`. `model` is optional and selects the
  agent's own model.
- Several ACP profiles may coexist with each other and with API providers; any
  provider can be the default.
- One agent process per turn, driven through `POST /api/ai/chat`, streamed in the
  OpenAI SSE delta shape so the browser parser is reused unchanged.
- Prose streaming plus one trace line for each tool the agent starts; the
  transcript is replayed as one flattened prompt behind a server-built context
  preamble (custom prompt and open note).
- Default resolution: a saved `ai.json` default (including "Make default" in
  Settings → AI) wins, then an ACP profile flagged `default: true`, then the
  first entry.
- Failure modes surfaced in-band as an SSE `event: error`.

**Out of scope / non-goals (accepted).**

- Permission cards, `fs/*`, `terminal`, a cancel route, server-side sessions,
  multi-turn agent state, images.
- An editable Settings → AI surface for the ACP profiles. Settings → AI shows
  every configured profile and the detected agents read-only; the config file
  is the only write path. "Make default" writes only `ai.json`'s default name.
- Rendering thought, plan, usage, or tool output beyond the one-line trace of
  each tool the agent starts.
- A notebook guarantee of confinement: `safe_path` and the approval cards do not
  apply to the agent.

**MVP line.** The delivered set is the MVP: one or more ACP profiles, picked and
streamed in the existing panel. Everything in §10 is follow-up, not a missing
MVP piece.

---

## 4. Verified current behavior (as built)

- **Config is server-local and hand-edited.** `ACP_FILE = config/acp.json`.
  Three shapes are accepted: `{"profiles": [ ... ]}`, a bare JSON array, and the
  legacy single profile object. `load_acp_configs` validates each entry on its
  own and returns the valid profiles; `load_acp_config` is a compatibility
  wrapper returning the first profile or `{}`. Neither raises: an unset,
  unreadable, or malformed file yields no profiles. Bounds: name ≤ 60 chars
  (`ACP_MAX_NAME_LEN`), command ≤ 300 (`ACP_MAX_COMMAND_LEN`), args ≤ 32 entries
  (`ACP_MAX_ARGS`) of ≤ 1000 chars (`ACP_MAX_ARG_LEN`), model ≤ 200
  (`ACP_MAX_MODEL_LEN`), `timeout` a finite positive number. An invalid entry is
  dropped individually; duplicate names keep the first; an entry whose name
  collides with an `ai.json` profile is dropped so the API profile keeps it. The
  file is read on every request, so edits take effect on the next send without a
  server restart.
- **`agent` names an allowlist entry; `command` is the escape hatch.**
  `ACP_KNOWN_AGENTS` is the server-side table of known agents (opencode, Claude
  Code, Codex, Gemini CLI, Goose, Cursor, Qwen, Kimi, Cline, OpenHands, Augment,
  Copilot, and Kiro). With `agent` set, the executable and argv are resolved from
  the table (`_acp_known_agent`, `_acp_agent_command` — a read-only
  `shutil.which` lookup) and a `command` alongside it is rejected. An unknown
  key, or a key whose executable is not on `PATH`, drops that entry. `command` +
  `args` remains for an agent the table does not know.
- **It is deliberately not writable through `POST /api/ai/config`.** The comment
  on `ACP_FILE` states the reason: a config blob any authed client can POST must
  never choose a command to execute. Verified by
  `test_config_post_never_touches_acp_file`.
- **Only the name, model, allowlist key, and default flag reach the browser.**
  `_public_acp_configs` returns one `{name, model, hasModel, agent, default}` per profile
  in an `acps` array (and keeps `acp` as the first entry or `null` for older
  clients); `command` / `args` / `env` / `cwd` / `timeout` stay server-side.
  `model` is the configured agent model, or the fallback label
  `ACP_LABEL = "ACP"`; `agent` names a table entry, not a secret, and the
  read-only Settings panel needs it to show which agent is selected (empty for a
  `command` profile). `default` is computed from the resolved default provider,
  not from the raw file flag.
- **Agent detection is read-only.** `_detect_acp_agents` returns
  `{key, label, available}` per known agent, plus `adapterMissing` and the
  install `hint` when the wrapping CLI is installed but its ACP adapter is not.
  `GET /api/ai/config` exposes the list as `acpAgents`. `shutil.which` only
  resolves a name against `PATH`; nothing runs.
- **Many profiles at once.** The loader returns a list, and `loadAiConfig`
  appends one picker entry per profile. ACP profiles coexist with each other and
  with API providers; any provider can be the default. "Make default" in
  Settings → AI sets `ai.json`'s default name, so it wins over a profile's
  `default: true` without the server rewriting `config/acp.json`.
  `_resolve_default_provider` resolves in order: a stored `ai.json` default that
  names a saved server or an ACP profile, the first ACP profile flagged
  `default: true`, then `""` (the frontend falls back to the first entry).
- **Routing.** `ai_chat` tries `_saved_server(name)` first; on a miss it asks
  `_acp_profile(name)` and, if a profile matches, calls `_acp_chat_response`. An
  unknown name is a plain 400 "Unknown or missing server", never an accidental
  ACP launch. `POST /api/ai/config` rejects a posted server name that equals an
  ACP profile name with 400, so the two lookups can never disagree.
- **Prompt assembly.** Messages are validated by the shared
  `_validate_chat_messages` with `drop_system=True`, so the notebook's system
  turn — the six-tool contract — never reaches the agent. The context that turn
  carried is rebuilt server-side by `_acp_context_preamble` and prepended once
  per turn: `ACP_CONTEXT_PREAMBLE`, then `The note currently open: <path>` when
  the workspace state names one (`workspaceState["<id>"].activeFile`, falling
  back to the top-level `activeFile`), then the global `custom_prompt` from
  `config/ai.json`. The surviving user/assistant turns are serialized
  `"User: …"` / `"Assistant: …"` joined by blank lines (`_flatten_acp_prompt`).
  An empty transcript is rejected 400; image parts are rejected 400; the
  assembled prompt is capped at `ACP_MAX_PROMPT_BYTES = 8 MiB`.
- **Workspace selection.** An optional body `workspace` id selects the workspace
  root the agent runs in and whose open note goes into the preamble. An unknown
  id is 404 `unknown_workspace`, never a silent fallback.
- **Streaming.** `_acp_chat_response` lazy-imports `acp_client` so a missing SDK
  disables only ACP, and re-emits each event as OpenAI delta frames. A tool the
  agent starts arrives as `{"acp":"trace","text":"<tool title>"}`, which the
  OpenAI-shaped parser ignores and the panel renders as a trace line.
  Completion is `data: [DONE]`; failure is an SSE `event: error`. Idle polls emit
  `: ping` comments and `X-Accel-Buffering: no` is set.
- **Client.** `acp_client.py` is Flask-free, owns one asyncio loop on a daemon
  thread (`_get_loop`), and spawns one agent process per turn inside `run_turn`.
  Prose and one `trace` per started tool are surfaced; thought, plan, and usage
  updates are dropped (`session_update`). `request_permission` auto-allows once.
  `fs/*`, `terminal/*`, and `elicitation/*` are refused with method-not-found
  (`read_text_file` … `create_elicitation`). A full-turn timeout defaults to
  `ACP_TURN_TIMEOUT_DEFAULT` (900 s). When a profile sets `model`, `_drive`
  applies it after `session/new` through the session's model config option
  (`category == "model"`, else id `"model"`) with `session/set_config_option`;
  no such option yields `"ACP agent does not expose a model option"`, a
  rejected value yields `"ACP agent rejected the configured model"`, and a
  value the agent acknowledges without selecting yields `"ACP agent did not
  apply the configured model"`. `run_turn`
  merges the server's full environment with the profile's `env` (the profile
  wins), so agent credentials and XDG paths are not trimmed away by the SDK's
  spawn transport. Browser disconnect raises `GeneratorExit`,
  cancels the future, and runs the SDK kill ladder.
- **Frontend.** `loadAiConfig` appends every `acps` entry to the picker,
  `refreshServerBar` renders `"<name> · <model>"`, and selecting one sets
  `currentServer`. `runToolLoop`, `regenerate`, `editLastMessage`, `Clear`, and
  the Stop button are provider-agnostic. The trace renderer inserts each
  `.ai-tool-trace` line above the growing answer bubble. `buildRequestMessages`
  and `send` strip image parts for an ACP profile and show one notice, so a stale
  image cannot poison later turns.
- **Settings → AI shows ACP read-only.** `buildAiAcpSection` renders one panel
  head/help, then one block per profile (`buildAiAcpProfile`: name, a `Default`
  tag or a `Make default` button, the allowlist/command note, and the configured
  agent model), then one detected-agent list (`buildAcpAgentLines`).
  `buildAiAcpInfoRow` shows the enable hint when no profile is configured but an
  agent is detected. "Make default" posts `default: <profile name>` through the
  provider save; it never edits the profile. The ACP section is held outside the
  editable provider list, so a provider save never carries a profile to the
  server.
- **Documentation status.** `README.md` and
  `docs/architecture/ai-assistant.md` document ACP, including the trust boundary
  and the read-only Settings panel, and `agent.md` describes it. `PLAN.md` holds
  the plan and `docs/architecture/acp-provider-review.md` the architecture
  review.

---

## 5. Functional flows

**F1 — Configure an agent.**
The owner copies `config/acp.json.example` to `config/acp.json` and adds one or
more entries under `profiles`, editing `agent` (or the `command` + `args` escape
hatch), `cwd`, `env`, `model`, `default`, `timeout`. There is no editable UI
step; Settings → AI shows the result read-only. An invalid entry is dropped on
its own, so a typo cannot disable the other profiles; when no valid profile
remains the feature is off and the picker shows no ACP entry. Example:
`{"profiles":[{"name":"opencode","agent":"opencode","default":false}]}`.

**F2 — Pick the agent.**
On panel mount, `loadAiConfig` fetches `/api/ai/config` and appends every `acps`
entry as an option labelled `"<name> · <model>"` after the OpenAI profiles. The
server has already resolved `cfg.default`: a saved `ai.json` default (including
"Make default" in Settings → AI) wins when it names any provider, then the first
ACP profile flagged `default: true`, then the first entry. Selecting an option
sets `currentServer`. A name or default change made after mount is not reflected
until `loadAiConfig` runs again (page load, or a Settings save, which calls it).

**F3 — Send a turn.**
`send` snapshots the composer, does the wire-size check, appends the user bubble,
pushes the user turn onto `conversation`, and enters `runToolLoop` (`ai.js`). The
request posts `{server, messages: [system, …conversation], workspace?}` to
`/api/ai/chat` (`buildRequestMessages`, `ai.js`). The server detects the ACP name,
validates and drops the system message, rejects images, flattens the rest into
one prompt behind `_acp_context_preamble`, spawns the agent, sends
`initialize → session/new → session/prompt` and applies the profile's `model`
between `session/new` and `prompt` when set (`_drive`, `acp_client.py`), and
streams `agent_message_chunk` text back as OpenAI deltas (`_acp_chat_response`).
`aiChat` (`api.js`) renders each delta into the assistant bubble exactly as for a
model.

**F4 — What the user sees.**
A user bubble, then an assistant bubble filling in with the agent's prose. Each
tool the agent starts adds a trace line above the growing bubble, so a long turn
shows activity; thought, plan, and usage updates are not rendered. During a
silent stretch the connection stays alive via `: ping` comments. The Stop (■)
button is available; the provider picker and attach button are disabled while the
turn is in flight (`ai.js`).

**F5 — How the turn ends.**
When the agent returns a stop reason, the server emits `data: [DONE]` and the
client exits the stream. `runToolLoop` then appends the Regenerate footer to the
newest assistant bubble and the Edit footer to the newest user bubble (`ai.js`).
`MAX_TOOL_ROUNDS` is irrelevant: a plain-prose ACP reply yields no `nb-tool`
blocks, so the loop breaks after one round.

**F6 — Failure.**
All failures are in-band on an HTTP 200 SSE response, unless validation fails
before the stream starts:
- **Agent missing / not executable** → `"ACP agent failed to start"`; the command
  line is logged, never sent to the browser (`_drive` / `run_turn`,
  `acp_client.py`).
- **Timeout** → `"ACP turn timed out after <N> seconds"` (`acp_client.py`).
- **Protocol mismatch** → `"ACP protocol version mismatch: agent offered <X>,
  client requires <Y>"` (`_drive`, `acp_client.py`).
- **Agent crashed / generic** → `"ACP turn failed"` or `"ACP agent stopped before
  completing the turn"` (`acp_client.py`).
- **Queue overflow** → `"ACP event queue overflowed; turn aborted"`
  (`_EventQueue`, `acp_client.py`).
- **SDK not installed** → `"ACP support is unavailable: the agent-client-protocol
  package is not installed"` (`_acp_chat_response`).
- **Validation** → HTTP 400 JSON: images, empty transcript, prompt too large,
  unknown server (`_acp_chat_response`, `ai_chat`); an unknown workspace is 404
  `unknown_workspace`.
The client shows the message in the bubble as `"AI request failed: <message>"`.

**F7 — Clear / Regenerate / Edit on an ACP provider.**
All three are unchanged from the OpenAI path:
- **Clear** empties the conversation, the log, and the attachment chips (`ai.js`).
  With ACP it also means the agent will not see any prior turn again.
- **Regenerate** trims `conversation` back to the last genuine user turn and
  re-runs it (`ai.js`). For ACP this re-spawns the agent with the same flattened
  transcript; the agent re-reads whatever it reads.
- **Edit** restores the last prompt (and attachments) into the composer and trims
  the turn from the conversation (`ai.js`). It never auto-sends.

---

## 6. Edge cases and failure modes

| Case | Required / observed behavior |
| --- | --- |
| `config/acp.json` missing or malformed | No valid profile: feature off; picker shows no ACP entry; no error (`load_acp_configs`). |
| One profile has an invalid field | That entry is dropped; the other profiles still load (`load_acp_configs`). |
| Two profiles share a name | The first entry is kept and the duplicate dropped. |
| Profile name equals an `ai.json` server name | The ACP entry is dropped; the API profile keeps the name, and a later POST of that server name is also rejected 400. |
| `agent` key unknown, or its executable not on `PATH` | That entry is dropped; no picker entry for it. The name is resolved from `ACP_KNOWN_AGENTS` only, never executed as a shell string. |
| `agent` and `command` both set | That entry is dropped as ambiguous; the other profiles still load. |
| Command is a wrapper such as `systemd-run …` written into `command` | Fails to start (argv[0] is the whole string; no shell). The wrapper must be `command` + `args`. The example does not show this. |
| Name matches neither an OpenAI profile nor the ACP profile | 400 "Unknown or missing server"; the ACP runner is not reached (`ai_chat`). |
| `workspace` in the POST body names no known workspace | 404 `unknown_workspace` before any agent is spawned. |
| ACP profile is `default: true` | It is the fallback default when `ai.json` names none; a saved `ai.json` default, including "Make default", wins (`_resolve_default_provider`). |
| Two ACP agents wanted at once | Supported: `config/acp.json` holds a `profiles` list (or a bare array), and the picker lists every valid profile. |
| `model` set but the agent exposes no model option | The turn ends with the in-band error "ACP agent does not expose a model option"; the agent does not silently run a different model. |
| `model` set to a value the agent rejects | The turn ends with the in-band error "ACP agent rejected the configured model". Model ids are the agent's own, e.g. `ollama/qwen3.8:latest` for `opencode acp`. |
| Agent needs a credential exported by the server | It is inherited: `run_turn` merges the server's full environment with the profile's `env`, so credentials and XDG paths are not trimmed away. A profile `env` value wins on a key collision. |
| User attaches an image while ACP is selected | The attach picker hides images, and `send` strips any pasted or dropped image parts, keeping the text, before the turn is sent. One inline notice says the image was not sent. `_acp_chat_response` still rejects an image part 400 as a backstop. |
| Image-bearing turn already in `conversation` | The images stay in the browser conversation and are stripped from the ACP request, so later ACP turns are not poisoned; switching back to an OpenAI profile sends them again. |
| User expects Settings → AI → Custom prompt to apply to the agent | It does: `_acp_context_preamble` reads `custom_prompt` from `config/ai.json` and prepends it to every ACP prompt. The agent still brings its own system prompt. |
| User expects the agent to know the open note | It does: the preamble names `The note currently open: <path>` from the workspace state, on every turn. |
| Active file changes mid-conversation | The preamble is rebuilt server-side on the next turn, so the new open note is named without the browser rebuilding a system prompt. |
| Agent's prose contains a fenced ` ```nb-tool ` or ` ```nb-edit ` block | The provider-agnostic tool loop still parses it (`runToolLoop`, `ai.js`) and may create a card or run a notebook tool the agent did not intend. |
| A tool the agent starts | One trace line naming the tool is inserted above the answer bubble; tool output, thought, and plan are not rendered. |
| Browser closes / Stop pressed mid-turn | `GeneratorExit` cancels the future and the SDK kill ladder reaps the child (`run_turn`, `acp_client.py`); no filesystem change the agent already made is rolled back. |
| Server process dies mid-turn | Child stdin closes; a conforming agent exits (`acp_client.py`; the `PLAN.md` `--debug` note). |
| Agent requests `fs/*`, `terminal/*`, or `elicitation/*` | Refused with JSON-RPC method-not-found; the turn continues (tested `test_client_bound_fs_terminal_and_elicitation_are_refused`, `test_all_capability_overrides_refuse_with_method_not_found`). |
| Agent requests permission | Auto-allowed once, or denied if no allow option is offered (`request_permission`; tested `test_permission_request_is_auto_allowed`). |
| Viewer role while auth is on | `/api/ai/config` is readable so the ACP entry appears in the picker, but `/api/ai/chat` is `@admin_required`; a send fails. Same as OpenAI profiles. |
| `config/acp.json` edited after the panel mounted | The server picks it up on the next request, but the picker label/default do not update until `loadAiConfig` runs again. |
| Prompt exceeds `ACP_MAX_PROMPT_BYTES` (8 MiB) | 400 before any agent is spawned (`_acp_chat_response`; tested `test_oversize_prompt_is_rejected`). |

---

## 7. Testable acceptance criteria

Each criterion names its verifier. Backend cases are `unittest` in
`tests/test_app.py` against the stub agent `tests/fixtures/stub_acp_agent.py`;
frontend cases are jsdom checks in `tests/dom/test_dom.js`; the rest are manual.
"Covered" means the current suite already asserts it; "gap" means it is stated but
not yet verified.

**Happy path**

1. ACP — a user turn against a configured profile streams the agent's chunks as
   OpenAI delta frames and ends with `data: [DONE]`.
   *Covered: `test_chat_streams_two_deltas_then_done`.*
2. ACP — a system message in the POSTed transcript never reaches the agent
   (the system text is absent from the echo; the user and assistant turns
   survive labelled). *Covered:
   `test_system_message_dropped_from_flattened_prompt`.*
3. Frontend — with `cfg.acps` populated, the picker lists every profile as
   `"<name> · <model>"` alongside the OpenAI profiles; with an empty list it
   lists none. *Covered by the `acp provider` block in `tests/dom/test_dom.js`.*
4. Frontend — selecting the ACP option makes it the active server and the chat
   request names it. *Covered by the `acp provider` block in
   `tests/dom/test_dom.js`.*
5. Frontend — an ordinary ACP prose reply renders as a normal assistant bubble
   with no tool cards. *Covered by the `acp provider` block in
   `tests/dom/test_dom.js`.*

**Failure modes**

6. ACP — a command that cannot be executed yields HTTP 200 with an SSE
   `event: error` whose message is `"ACP agent failed to start"`.
   *Covered: `test_bad_command_is_inband_error_not_500`.*
7. ACP — a wrong protocol version yields an in-band error naming both the offered
   and the required version. *Covered:
   `test_protocol_version_mismatch_names_both_versions`.*
8. ACP — an agent that crashes before `initialize` yields an in-band error, not a
   500. *Covered: `test_crash_before_initialize_is_inband_error`.*
9. ACP — a hung agent is timed out at the configured `timeout` and its child is
   reaped. *Covered: `test_hung_agent_times_out_and_is_reaped`.*
10. ACP — an agent that ignores stdin EOF and SIGTERM is SIGKILLed and reaped
    before the turn reports done. *Covered:
    `test_eof_ignoring_agent_is_reaped_before_done`.*
11. ACP — a malformed NDJSON line before a valid response is skipped, not fatal.
    *Covered: `test_junk_line_before_valid_response_is_skipped`.*
12. Backend — a name matching neither list is 400 and never falls through to ACP.
    *Covered: `test_unknown_server_does_not_fall_through_to_acp`.*
13. Backend — an image-bearing transcript is 400 with the "do not support image
    attachments" message before any agent is spawned. *Covered:
    `test_image_attachment_rejected_400`.*
14. Frontend — attaching an image while ACP is selected strips it from the
    request, keeps the text, and shows one inline notice; the browser
    conversation keeps the image so switching back to an OpenAI profile sends it
    again. **Gap**: the strip and notice are stated in `ai.js`
    (`buildRequestMessages`, `send`, `showAcpImageNotice`) and not asserted in the
    DOM suite; the server 400 backstop is covered by criterion 13.
15. Backend — a prompt over `ACP_MAX_PROMPT_BYTES` is 400. *Covered:
    `test_oversize_prompt_is_rejected`.*

**Isolation and security**

16. The browser never receives `command`, `args`, `env`, `cwd`, or `timeout`:
    `GET /api/ai/config` exposes every ACP profile in `acps` as exactly
    `{name, model, hasModel, agent, default}`, and keeps `acp` as the first entry (or
    `null`). *Covered: `test_public_profile_exposes_only_safe_keys` asserts the
    exact key set per profile and the legacy `acp` alias;
    `test_known_agent_key_resolves_command` asserts `agent` is exposed and the
    command line is not.*
17. No `POST /api/ai/config` path creates, edits, or deletes `config/acp.json`.
    *Covered: `test_config_post_never_touches_acp_file`.*
18. An agent request for `fs/*`, `terminal/*`, or `elicitation/*` comes back as a
    JSON-RPC method-not-found error and does not hang the turn. *Covered:
    `test_client_bound_fs_terminal_and_elicitation_are_refused`,
    `test_all_capability_overrides_refuse_with_method_not_found`,
    `test_create_elicitation_override_refuses_method`.*
19. An agent permission request is auto-allowed once (allow_once preferred over
    allow_always) with the single-user rationale documented. *Covered:
    `test_permission_request_is_auto_allowed`.*
20. The ACP turn is `@admin_required`: a viewer token is rejected while auth is on.
    *Covered for the route family at `test_viewer_token_is_rejected`; the
    ACP-specific case is not separately asserted.*
21. The agent runs with the configured `cwd`, else the selected workspace root, so
    relative-path tool calls resolve against the notebook by default.
    *Stated in `_acp_chat_response`; not independently asserted.*
22. Manual — with `config/acp.json` pointing at `opencode acp`, pick the profile,
    send one message, and confirm prose streams and the turn ends
    (`PLAN.md`). **Gap**: not recorded as run.

**Frontend parity**

23. Regenerate on an ACP turn re-sends the same flattened transcript and replaces
    the reply; Edit restores the last prompt into the composer without auto-send;
    Clear empties the transcript and the attachments. *Covered generically by the
    existing turn-review tests; not asserted with `currentServer` set to an ACP
    profile. **Gap**.*
24. The resolved default is selected on mount: a saved `ai.json` default wins
    when it names any provider (including "Make default" on an ACP profile),
    then the first ACP profile flagged `default: true`, then the first entry.
    *Covered: `test_default_resolution` and
    `test_post_accepts_default_naming_an_acp_profile` in `TestAcpConfig`; the
    picker selection is asserted in the `acp provider` DOM block.*
25. Settings → AI shows every configured ACP profile read-only (name, a `Default`
    tag or `Make default`, allowlist/command note, and the configured agent
    model) plus the detected agents with installed / adapter missing / not
    installed; "Make default" posts only the profile name, and the ACP section is
    not in the editable provider list. *Covered by the Settings ACP checks in the
    `acp provider` block, `tests/dom/test_dom.js`.*
26. Frontend — an ACP `trace` frame renders one `.ai-tool-trace` line above the
    growing answer bubble, and an OpenAI stream with no trace frames adds none.
    *Covered by the ACP tool-activity block in `tests/dom/test_dom.js`.*
27. Backend — the preamble carries the fixed lead, the open note, and the custom
    prompt, degrades to the fixed lead when neither is set, is prepended once per
    turn, and degrades on a corrupt config. *Covered:
    `test_preamble_reaches_agent_with_open_file_and_custom_prompt`,
    `test_preamble_degrades_to_fixed_lead_when_context_absent`,
    `test_preamble_prepended_once_even_with_prior_turns`,
    `test_context_preamble_degrades_on_corrupt_config`.*

---

## 8. Constraints and dependencies

- **Pinned SDK.** `agent-client-protocol==0.12.1` (`requirements.txt`), speaking
  ACP v1. `ACP_PROTOCOL_VERSION` tracks the SDK constant (`acp_client.py`) so a
  wire-version bump is a deliberate review point.
- **One process per turn, no session.** The server is request-stateless; the
  browser owns the transcript. The cost is that multi-turn context is a replayed
  flattening and the agent re-reads files every turn (`PLAN.md`).
- **No shell.** `command`/`args` are passed to `create_subprocess_exec`; a wrapper
  must be split into `command` + `args`.
- **Model ids belong to the agent.** `model` is applied through the agent's own
  session config option; a value the agent does not offer ends the turn with an
  error rather than falling back silently. Verified values for `opencode acp`
  look like `ollama/qwen3.8:latest`.
- **Environment is inherited.** The agent sees the server's full environment with
  the profile's `env` overlaid (the profile wins), so it can use credentials and
  XDG paths the server exports. This also means anything in the server's
  environment is visible to the agent; confine it with the `command` wrapper if
  that matters.
- **Timeout is a backstop, not a budget.** The default is 900 s precisely because
  an agent may legitimately run a long tool loop (`ACP_TURN_TIMEOUT_DEFAULT`,
  `acp_client.py`).
- **Latency.** A turn's time-to-first-token is the agent's own start-up plus its
  first prose; the SSE keep-alive exists to survive the silent gap.
- **No server storage.** No session file, no log, no artifact. `config/acp.json`
  is the only ACP state.
- **Docs are in sync.** `README.md` and `docs/architecture/ai-assistant.md`
  document ACP, including the trust boundary, the multiple-profile config, the
  model option, and the read-only Settings panel; `agent.md` describes it.
  `PLAN.md` holds the plan and `docs/architecture/acp-provider-review.md` the
  architecture review.
- **`ai_probe` cannot test an ACP profile.** `ai_probe` only searches `ai.json`,
  so an ACP name returns 404 "Unknown server". No UI exposes this today, but a
  future "Test" button would 404.
- **Tests are host-only.** Nothing runs on target; the stub agent is stdlib-only
  and needs no real CLI.

---

## 9. Verdict — is this what we want?

The delivered behaviour matches the stated intent on the core promise: **one
picker, one panel, one stream.** The ACP profile appears beside the models, a
turn streams into the same bubble, and Regenerate / Edit / Clear / Stop behave
the same. The execution-model divergence was stated up front and is honestly
implemented: `safe_path`, the six tools, and the approval cards do not reach the
agent.

Three questions the brief asks, answered plainly.

### 9(a) Hand-edited `config/acp.json` with a read-only Settings panel — acceptable, or does it break "just another provider"?

**It breaks the provider-management experience, but not the chat experience, and
the break is deliberate.**

- The security reason is sound and stated in the code: a blob any authed client
  can POST must never choose a command to execute. A writable "just another
  provider" Settings tab would reintroduce exactly the LAN writable-RCE surface
  the plan set out to avoid. The allowlist (`agent`) narrows this further: the
  browser can name a known agent, never supply an argv.
- Settings → AI shows every profile and the detected agents, so the feature is
  discoverable; what the owner still cannot do there is add, edit, test, or
  remove a profile — that is file-editing plus a page reload, though "Make
  default" is one click. `ai_probe` cannot test an ACP profile at all (§8).
- **Ambiguity to state, not invent:** the goal lists *four* example agents
  (opencode, Gemini CLI, Claude Code, Goose). The build now supports **several
  profiles** and switching between them in the picker; any of the thirteen
  allowlisted agents can be a profile. Adding, editing, or removing one is still
  a file edit.
- **Verdict:** acceptable as a deliberate, security-motivated decision for
  hand-edited profiles. It is not "just another provider" in configuration; it
  is "just another provider" only in selection and streaming. If the owner wants
  to add or remove agents casually, the file edit will feel wrong.

### 9(b) Prose plus a tool-start trace, no thought/progress detail — acceptable for an agent running its own multi-step tools?

**Acceptable as a first cut; progress detail is still the weakest part.**

- The agent may run many tool calls before its first prose, so the owner watches
  a bubble fill in slowly. Each started tool adds a trace line, so the turn is no
  longer indistinguishable from a hang; the keep-alive keeps the connection open
  through the gaps. The Stop button is the second feedback path.
- This is a presentation gap, not a protocol gap: the ACP client already receives
  thought, plan, and usage updates on the event-loop thread and drops them by
  design (`session_update`, `acp_client.py`). Surfacing them would need a new wire
  vocabulary and rendering, which is why it was deferred.
- For a chat model a silent wait is tolerable. For a coding agent that reads and
  writes files and runs commands, a tool title alone does not let the owner judge
  a wrong direction before it is costly.
- **Verdict:** ship-able for short turns; not fully comfortable for real agentic
  work. If the owner uses this daily, richer progress rendering should move up the
  list (§10 R3).

### 9(c) The trust boundary — will the owner actually be comfortable?

**Only if the deployment context is understood; the design is honest and the
consequence is now documented.**

- The agent runs as the server user with the server user's filesystem access,
  minus whatever the launcher confines. The code says so and the plan lists it as
  an accepted limitation (`PLAN.md`).
- The code auto-allows **every** tool call (`request_permission`,
  `acp_client.py`), so within a turn there is no per-action confirmation. This is
  coherent for a single-user server where the owner can already edit those files
  in a terminal.
- The part that should give the owner pause: the server is reachable on the LAN
  by default (`./start.sh` binds `0.0.0.0:5000`) and auth is off by default. Under
  those defaults, anyone who can reach the port can trigger an agent run that
  edits files as the server user. That is a materially larger blast radius than
  "chat with a model". `safe_path` does not bound it. `README.md` now carries the
  trust-boundary section, so a reader of the docs can learn this.
- **Ambiguity to state, not invent:** the design assumes the operator runs with
  auth on and/or a loopback bind, or accepts the exposure. Whether the owner
  actually does is a deployment fact this spec cannot assert.
- **Verdict:** honest and defensible as an operator's decision. It is now
  *safe-by-communication* — the consequence is in the README as well as the code.
  If the owner runs auth-off on a shared LAN, they should not use it.

---

## 10. Gaps / follow-ups, ranked

1. **Document the trust-boundary change in `README.md` and
   `docs/architecture/ai-assistant.md`; update `agent.md`.** **Done.**
   *Why it mattered:* a security-relevant behaviour change was only in a code
   comment and a plan. The README now documents the ACP flow, the read-only
   Settings panel, the trust boundary, and the wrapper form of `command`; the
   architecture doc and `agent.md` cover the same ground.
2. **Assert the ACP image strip in the DOM suite.** *Why:* `buildRequestMessages`
   and `send` now drop image parts and show one notice, so a stale image cannot
   poison later turns, but no DOM check asserts the strip or the notice; the
   server 400 remains covered by criterion 13.
3. **Render richer agent progress (thought / plan / file-changed).** *Why:* a
   tool-start trace line now shows activity, but the detail the client already
   receives is dropped (`session_update`, `acp_client.py`), so a wrong direction
   is still hard to spot early.
4. **Decide whether a minimal Settings surface (add/test/remove without exposing
   the command) is wanted.** *Why:* several profiles are now configurable and
   selectable, but adding or removing one is still a file edit, and `ai_probe`
   cannot test it. The "Make default" action is the only Settings write.
5. **Guard the provider-agnostic tool loop from an ACP agent's prose.** *Why:* a
   `nb-tool`/`nb-edit` fenced block in the agent's output is still parsed
   (`runToolLoop`, `ai.js`) and could create a card or execute a notebook tool for
   a provider that is supposed to run its own tools.
6. **Document/validate the wrapper form of `command`.** *Why:* `command` is argv[0]
   with no shell, so `"command": "systemd-run --scope opencode acp"` silently
   fails; only `command` + `args` works. The README now shows the split form.
7. **Add the missing ACP test cases from §7 (criteria 14, 21, 22, 23).**
   *Why:* the isolation property is well tested; the client image strip, `cwd`
   resolution, and ACP Regenerate/Edit paths are not.

---

## 11. Open questions

1. **One agent or many?** *Resolved.* `config/acp.json` accepts several profiles
   (`{"profiles": [...]}` or a bare array), the picker lists every valid one,
   they coexist with API providers, and any provider can be the default. Adding,
   editing, or removing a profile is still a file edit; a Settings surface for
   that remains §10 item 4. Owner: product + user.
2. **Where is the feature discovered?** *Resolved.* Settings → AI shows the
   configured profile, the detected agents, and — when no profile exists but an
   agent is installed — the `"agent": "<key>"` hint. The README repeats the setup.
   Owner: product + `ui-designer`.
3. **Progress rendering scope.** If richer agent progress is surfaced, which of
   thought / file-changed / command is shown, and does it need the same
   reviewability the notebook's cards have? The tool-start trace line is the
   current ceiling. Owner: product + `architect`.
4. **Deployment assumption.** Does the owner run with auth on and/or a loopback
   bind when using ACP profiles, or accept LAN exposure with auth off? The
   trust-boundary verdict depends on this. Owner: user.
5. **Custom prompt and context.** *Resolved.* `_acp_context_preamble` prepends
   `ACP_CONTEXT_PREAMBLE`, the open note, and the global custom prompt to every
   ACP turn, with no browser-side second format. Owner: product.
6. **Regenerate semantics for a stateless agent.** Is "re-run the whole flattened
   transcript in a fresh process" the desired Regenerate meaning, given the agent
   re-reads files and any side effects it already made are not undone? Owner:
   product + user.
