# Feature: ACP provider — external coding agents in the AI assistant

**Author:** product-designer
**Date:** 2026-10-13
**Status:** Product definition and post-build validation of a delivered feature.
No technical or visual design chosen here. Written after the build; it states the
intent the build was meant to serve and whether the delivered behaviour serves it.
**Inputs:** `acp_client.py`; `app.py` (`load_acp_config` at 1240, `_public_acp_config`
at 1380, `_flatten_acp_prompt` at 1640, `_acp_chat_response` at 1679, `ai_chat` at
1759); `static/js/ai.js` (`loadAiConfig` at 2179, picker at 2213, `runToolLoop` at
1239); `static/js/api.js` (`aiChat` at 102); `config/acp.json` and
`config/acp.json.example`; `tests/test_app.py` (`TestAcpConfig` at 2909, `TestAcpChat`
at 3015); `tests/dom/test_dom.js` (`acp provider` block at 21735);
`tests/fixtures/stub_acp_agent.py`; `PLAN.md` (ACP plan at 323);
`docs/architecture/acp-provider-review.md`. All line numbers verified 2026-10-13.

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
| Config | `config/ai.json`, editable in Settings → AI | Hand-edited `config/acp.json`, not in Settings |

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

- A second provider type, ACP, surfaced in the existing picker.
- Hand-edited `config/acp.json` with `name`, `command`, `args`, `cwd`, `env`,
  `default`, `timeout`.
- One agent process per turn, driven through `POST /api/ai/chat`, streamed in the
  OpenAI SSE delta shape so the browser parser is reused unchanged.
- Prose streaming only; the transcript is replayed as one flattened prompt.
- `default: true` nominates the ACP profile as the startup pick.
- Failure modes surfaced in-band as an SSE `event: error`.

**Out of scope / non-goals (accepted).**

- Permission cards, `fs/*`, `terminal`, a cancel route, server-side sessions,
  multi-turn agent state, images.
- Any Settings → AI UI for the ACP profile.
- Rendering thought / tool-call / plan / usage updates.
- A notebook guarantee of confinement: `safe_path` and the approval cards do not
  apply to the agent.

**MVP line.** The delivered set is the MVP: one ACP profile, picked and streamed
in the existing panel. Everything in §10 is follow-up, not a missing MVP piece.

---

## 4. Verified current behavior (as built)

- **Config is server-local and hand-edited.** `ACP_FILE = config/acp.json`
  (`app.py:1186`). `load_acp_config` (`app.py:1240`) validates the whole object and
  degrades to `{}` on any violation — never raises. Bounds: name ≤ 60 chars
  (`1191`), command ≤ 300 (`1192`), args ≤ 32 entries (`1193`) of ≤ 1000 chars
  (`1194`), `timeout` a finite positive number (`1303-1310`). The file is read on
  every request, so edits take effect on the next send without a server restart.
- **It is deliberately not writable through `POST /api/ai/config`.** The comment
  at `app.py:1182-1185` states the reason: a config blob any authed client can
  POST must never choose a command to execute. Verified by
  `test_config_post_never_touches_acp_file` (`tests/test_app.py:2992`).
- **Only the name, label, and default flag reach the browser.**
  `_public_acp_config` (`app.py:1380`) returns `{name, model, default}` and
  nothing else; `command` / `args` / `env` stay server-side. The fixed label is
  `ACP_LABEL = "ACP"` (`app.py:1199`).
- **One profile only.** The loader returns a single object, not a list, and the
  picker appends exactly one entry (`static/js/ai.js:2186-2192`). Multiple ACP
  agents cannot coexist.
- **Routing.** `ai_chat` tries `_saved_server(name)` first (`app.py:1780`); on a
  miss it loads the ACP config and, if the name matches, calls
  `_acp_chat_response` (`app.py:1783-1784`). An unknown name is a plain 400
  "Unknown or missing server" (`app.py:1785`), never an accidental ACP launch.
- **Prompt assembly.** Messages are validated by the shared
  `_validate_chat_messages` with `drop_system=True` (`app.py:1694`), so the
  notebook's own system prompt — the six-tool contract, the custom prompt, the
  active-file context — never reaches the agent. The surviving user/assistant
  turns are serialized `"User: …"` / `"Assistant: …"` joined by blank lines
  (`_flatten_acp_prompt`, `app.py:1640-1661`). An empty transcript is rejected 400
  (`app.py:1698`); image parts are rejected 400 (`app.py:1704`); the flattened
  prompt is capped at `ACP_MAX_PROMPT_BYTES = 8 MiB` (`app.py:1195`, `1707-1708`).
- **Streaming.** `_acp_chat_response` lazy-imports `acp_client` (`app.py:1711`)
  so a missing SDK disables only ACP, and re-emits each event as OpenAI delta
  frames, `data: [DONE]` on completion, and an SSE `event: error` on failure
  (`app.py:1724-1752`). Idle polls emit `: ping` comments (`app.py:1745`) and
  `X-Accel-Buffering: no` is set (`app.py:1754`).
- **Client.** `acp_client.py` is Flask-free, owns one asyncio loop on a daemon
  thread (`_get_loop`, `acp_client.py:132`), and spawns one agent process per
  turn inside `run_turn` (`acp_client.py:233`). Only `agent_message_chunk` is
  surfaced; thought / tool-call / plan / usage updates are dropped
  (`acp_client.py:74-79`). `request_permission` auto-allows once
  (`acp_client.py:81-103`). `fs/*` and `terminal/*` are refused with
  method-not-found (`acp_client.py:109-129`). A full-turn timeout defaults to 900 s
  (`ACP_TURN_TIMEOUT_DEFAULT`, `acp_client.py:39`). Browser disconnect raises
  `GeneratorExit`, cancels the future, and runs the SDK kill ladder
  (`acp_client.py:286-290`).
- **Frontend.** `loadAiConfig` appends the ACP entry to the picker
  (`static/js/ai.js:2186-2192`), `refreshServerBar` renders `"<name> · <model>"`
  (`static/js/ai.js:2229`), selecting it sets `currentServer`
  (`static/js/ai.js:1798-1803`). `runToolLoop`, `regenerate`, `editLastMessage`,
  `Clear`, and the Stop button are provider-agnostic and were not branched for ACP
  (`static/js/ai.js:1239`, `1338`, `1358`, `1768`, `2131`).
- **Settings → AI ignores ACP.** `settings.js` has no ACP reference; the DOM test
  asserts the provider list renders only the OpenAI entry
  (`tests/dom/test_dom.js:21825-21831`).
- **Documentation status.** `README.md`, `docs/architecture/ai-assistant.md`,
  `agent.md`, and `static/js/ai.js`'s header comment contain **no** ACP mention
  (verified by search on 2026-10-13). `PLAN.md:323` is the plan and
  `docs/architecture/acp-provider-review.md` is the architecture review; there is
  no user-facing write-up of the trust-boundary change.

---

## 5. Functional flows

**F1 — Configure an agent.**
The owner copies `config/acp.json.example` to `config/acp.json` and edits
`command`, `args`, `cwd`, `env`, `default`, `timeout`. There is no UI step. A
malformed file turns the feature off silently (the picker simply shows no ACP
entry). Example: `{"name":"opencode","command":"opencode","args":["acp"],
"cwd":"","default":false}`.

**F2 — Pick the agent.**
On panel mount, `loadAiConfig` fetches `/api/ai/config`; if `cfg.acp.name` is set,
one option labelled `"<name> · ACP"` is appended after the OpenAI profiles. An
ACP `default: true` makes it the startup selection and beats the `ai.json`
default; otherwise the `ai.json` default or first server wins
(`static/js/ai.js:2186-2198`). Selecting it sets `currentServer`. A name or
default change made after mount is not reflected until `loadAiConfig` runs again
(page load, or a Settings save, which calls it).

**F3 — Send a turn.**
`send` snapshots the composer, does the wire-size check, appends the user bubble,
pushes the user turn onto `conversation`, and enters `runToolLoop`
(`static/js/ai.js:1212`). The request posts
`{server, messages: [system, …conversation]}` to `/api/ai/chat`
(`static/js/ai.js:1258`). The server detects the ACP name, validates and drops the
system message (`app.py:1694`), rejects images (`app.py:1704`), flattens the rest
into one prompt (`app.py:1706`), spawns the agent, sends `initialize → session/new
→ session/prompt` (`acp_client.py:183-204`), and streams `agent_message_chunk`
text back as OpenAI deltas (`app.py:1730-1733`). `api.js:149-153` renders each
delta into the assistant bubble exactly as for a model.

**F4 — What the user sees.**
A user bubble, then an assistant bubble filling in with the agent's prose. During
a long silent agent turn the connection stays alive via `: ping` comments; nothing
is rendered for them. The Stop (■) button is available; the provider picker and
attach button are disabled while the turn is in flight (`static/js/ai.js:1865-1867`).
Nothing indicates thought, tool calls, files touched, or commands run.

**F5 — How the turn ends.**
When the agent returns a stop reason, the server emits `data: [DONE]` and the
client exits the stream. `runToolLoop` then appends the Regenerate footer to the
newest assistant bubble and the Edit footer to the newest user bubble
(`static/js/ai.js:1329-1331`). `MAX_TOOL_ROUNDS` is irrelevant: a plain-prose ACP
reply yields no `nb-tool` blocks, so the loop breaks after one round.

**F6 — Failure.**
All failures are in-band on an HTTP 200 SSE response, unless validation fails
before the stream starts:
- **Agent missing / not executable** → `"ACP agent failed to start"`; the command
  line is logged, never sent to the browser (`acp_client.py:213-219`).
- **Timeout** → `"ACP turn timed out after <N> seconds"` (`acp_client.py:210-212`).
- **Protocol mismatch** → `"ACP protocol version mismatch: agent offered <X>,
  client requires <Y>"` (`acp_client.py:191-196`).
- **Agent crashed / generic** → `"ACP turn failed"` or `"ACP agent stopped before
  completing the turn"` (`acp_client.py:220-230`).
- **Queue overflow** → `"ACP event queue overflowed; turn aborted"`
  (`acp_client.py:265-267`).
- **SDK not installed** → `"ACP support is unavailable: the agent-client-protocol
  package is not installed"` (`app.py:1711-1714`).
- **Validation** → HTTP 400 JSON: images (`app.py:1704`), empty transcript
  (`app.py:1698`), prompt too large (`app.py:1708`), unknown server
  (`app.py:1785`).
The client shows the message in the bubble as `"AI request failed: <message>"`.

**F7 — Clear / Regenerate / Edit on an ACP provider.**
All three are unchanged from the OpenAI path:
- **Clear** empties the conversation, the log, and the attachment chips
  (`static/js/ai.js:1770-1778`). With ACP it also means the agent will not see any
  prior turn again.
- **Regenerate** trims `conversation` back to the last genuine user turn and
  re-runs it (`static/js/ai.js:1338-1353`). For ACP this re-spawns the agent with
  the same flattened transcript; the agent re-reads whatever it reads.
- **Edit** restores the last prompt (and attachments) into the composer and trims
  the turn from the conversation (`static/js/ai.js:1358-1380`). It never auto-sends.

---

## 6. Edge cases and failure modes

| Case | Required / observed behavior |
| --- | --- |
| `config/acp.json` missing or malformed | Feature off; picker shows no ACP entry; no error (`app.py:1251-1256`). |
| Command is a wrapper such as `systemd-run …` written into `command` | Fails to start (argv[0] is the whole string; no shell). The wrapper must be `command` + `args`. The example does not show this. |
| Name matches neither an OpenAI profile nor the ACP profile | 400 "Unknown or missing server"; the ACP runner is not reached (`app.py:1785`). |
| ACP profile is `default: true` | Selected on panel mount; beats the `ai.json` default (`static/js/ai.js:2196-2198`). |
| Two ACP agents wanted at once | Not supported: one profile only (§4). |
| User attaches an image while ACP is selected | The UI offers the attach button; the send is rejected 400 "ACP profiles do not support image attachments" (`app.py:1704`). |
| Image-bearing turn already in `conversation` | **Every later ACP turn also fails**, because `_acp_chat_response` scans the whole transcript for image parts (`app.py:1700-1704`) and the client does not rewrite the failed turn. Only Clear or Edit recovers it. |
| User expects Settings → AI → Custom prompt to apply to the agent | It does not: the server drops all system messages for ACP (`app.py:1694`). The agent brings its own system prompt. |
| User expects the agent to know the open note | It does not: the active-file context lives in the notebook system prompt, which is dropped. |
| Active file changes mid-conversation | `invalidateSystem` rebuilds a prompt the ACP path discards (`static/js/ai.js:1798-1803`). |
| Agent's prose contains a fenced ` ```nb-tool ` or ` ```nb-edit ` block | The provider-agnostic tool loop still parses it (`static/js/ai.js:1289`) and may create a card or trace the agent did not intend. |
| Browser closes / Stop pressed mid-turn | `GeneratorExit` cancels the future and the SDK kill ladder reaps the child (`acp_client.py:286-290`); no filesystem change the agent already made is rolled back. |
| Server process dies mid-turn | Child stdin closes; a conforming agent exits (`acp_client.py:14-16`; PLAN `--debug` note at `PLAN.md:410`). |
| Agent requests `fs/read_text_file` or `terminal/create` | Refused with JSON-RPC method-not-found; the turn continues (`acp_client.py:109-129`; tested `tests/test_app.py:3198`). |
| Agent requests permission | Auto-allowed once, or denied if no allow option is offered (`acp_client.py:81-103`; tested `tests/test_app.py:3185`). |
| Viewer role while auth is on | `/api/ai/config` is readable so the ACP entry appears in the picker, but `/api/ai/chat` is `@admin_required`; a send fails. Same as OpenAI profiles. |
| `config/acp.json` edited after the panel mounted | The server picks it up on the next request, but the picker label/default do not update until `loadAiConfig` runs again. |
| Prompt exceeds `ACP_MAX_PROMPT_BYTES` (8 MiB) | 400 before any agent is spawned (`app.py:1707-1708`). |

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
   *Covered: `test_chat_streams_two_deltas_then_done`, `tests/test_app.py:3068`.*
2. ACP — a system message in the POSTed transcript never reaches the agent
   (only `User:` / `Assistant:` labels appear in the echo). *Covered:
   `test_system_message_dropped_from_flattened_prompt`, `tests/test_app.py:3080`.*
3. Frontend — with `cfg.acp` set, the picker lists `"<name> · ACP"` alongside the
   OpenAI profiles; with `cfg.acp` null it lists none. *Covered:
   `tests/dom/test_dom.js:21771`, `21786-21791`.*
4. Frontend — selecting the ACP option makes it the active server and the chat
   request names it. *Covered: `tests/dom/test_dom.js:21797-21808`.*
5. Frontend — an ordinary ACP prose reply renders as a normal assistant bubble
   with no tool trace lines and no `nb-tool`/`nb-edit` cards. *Covered:
   `tests/dom/test_dom.js:21809-21815`.*

**Failure modes**

6. ACP — a command that cannot be executed yields HTTP 200 with an SSE
   `event: error` whose message is `"ACP agent failed to start"`.
   *Covered: `test_bad_command_is_inband_error_not_500`, `tests/test_app.py:3139`.*
7. ACP — a wrong protocol version yields an in-band error naming both the offered
   and the required version. *Covered:
   `test_protocol_version_mismatch_names_both_versions`, `tests/test_app.py:3154`.*
8. ACP — an agent that crashes before `initialize` yields an in-band error, not a
   500. *Covered: `test_crash_before_initialize_is_inband_error`,
   `tests/test_app.py:3210`.*
9. ACP — a hung agent is timed out at the configured `timeout` and its child is
   reaped. *Covered: `test_hung_agent_times_out_and_is_reaped`,
   `tests/test_app.py:3238`.*
10. ACP — an agent that ignores stdin EOF and SIGTERM is SIGKILLed and reaped
    before the turn reports done. *Covered:
    `test_eof_ignoring_agent_is_reaped_before_done`, `tests/test_app.py:3165`.*
11. ACP — a malformed NDJSON line before a valid response is skipped, not fatal.
    *Covered: `test_junk_line_before_valid_response_is_skipped`,
    `tests/test_app.py:3219`.*
12. Backend — a name matching neither list is 400 and never falls through to ACP.
    *Covered: `test_unknown_server_does_not_fall_through_to_acp`,
    `tests/test_app.py:3123`.*
13. Backend — an image-bearing transcript is 400 with the "do not support image
    attachments" message before any agent is spawned. *Covered:
    `test_image_attachment_rejected_400`, `tests/test_app.py:3100`.*
14. Frontend — attaching an image while ACP is selected shows the server message
    and the conversation is recoverable by Clear/Edit. **Gap**: the rejection is
    verified server-side (criterion 13), but the poisoned-transcript recovery path
    is not.
15. Backend — a prompt over `ACP_MAX_PROMPT_BYTES` is 400. **Gap**: stated in code
    (`app.py:1707-1708`), no test asserts it.

**Isolation and security**

16. The browser never receives `command`, `args`, or `env`: `GET /api/ai/config`
    exposes exactly `{name, model, default}` for ACP. *Covered:
    `test_valid_file_exposed_masked`, `tests/test_app.py:2923`.*
17. No `POST /api/ai/config` path creates, edits, or deletes `config/acp.json`.
    *Covered: `test_config_post_never_touches_acp_file`, `tests/test_app.py:2992`.*
18. An agent request for `fs/read_text_file` or `terminal/create` comes back as a
    JSON-RPC method-not-found error and does not hang the turn. *Covered:
    `test_client_bound_fs_and_terminal_requests_are_refused`, `tests/test_app.py:3198`.*
19. An agent permission request is auto-allowed once (allow_once preferred over
    allow_always) with the single-user rationale documented. *Covered:
    `test_permission_request_is_auto_allowed`, `tests/test_app.py:3185`.*
20. The ACP turn is `@admin_required`: a viewer token is rejected while auth is on.
    *Covered for the route family at `test_viewer_token_is_rejected`,
    `tests/test_app.py:3264`; the ACP-specific case is not separately asserted.*
21. The agent runs with the configured `cwd`, else the notebook folder, so
    relative-path tool calls resolve against the notebook by default.
    *Stated: `app.py:1718-1720`; not independently asserted.*
22. Manual — with `config/acp.json` pointing at `opencode acp`, pick the profile,
    send one message, and confirm prose streams and the turn ends
    (`PLAN.md:397`). **Gap**: not recorded as run.

**Frontend parity**

23. Regenerate on an ACP turn re-sends the same flattened transcript and replaces
    the reply; Edit restores the last prompt into the composer without auto-send;
    Clear empties the transcript and the attachments. *Covered generically by the
    existing turn-review tests; not asserted with `currentServer` set to an ACP
    profile. **Gap**.*
24. Choosing ACP as `default: true` selects it on mount. *Covered in code
    (`static/js/ai.js:2196-2198`); not asserted in the DOM suite. **Gap**.*

---

## 8. Constraints and dependencies

- **Pinned SDK.** `agent-client-protocol==0.12.1` (`requirements.txt`), speaking
  ACP v1. `ACP_PROTOCOL_VERSION` tracks the SDK constant (`acp_client.py:35`) so a
  wire-version bump is a deliberate review point.
- **One process per turn, no session.** The server is request-stateless; the
  browser owns the transcript. The cost is that multi-turn context is a replayed
  flattening and the agent re-reads files every turn (`PLAN.md:406-407`).
- **No shell.** `command`/`args` are passed to `create_subprocess_exec`; a wrapper
  must be split into `command` + `args`.
- **Timeout is a backstop, not a budget.** The default is 900 s precisely because
  an agent may legitimately run a long tool loop (`acp_client.py:36-39`).
- **Latency.** A turn's time-to-first-token is the agent's own start-up plus its
  first prose; the SSE keep-alive exists to survive the silent gap, not to show
  progress.
- **No server storage.** No session file, no log, no artifact. `config/acp.json`
  is the only ACP state.
- **Docs sync not done.** `README.md`, `docs/architecture/ai-assistant.md`,
  `agent.md`, and the `static/js/ai.js` header do not mention ACP. `PLAN.md`
  step 7 required the README trust boundary and the architecture doc to be
  updated in the same change; they were not.
- **`ai_probe` cannot test an ACP profile.** `ai_probe` (`app.py:1526-1546`) only
  searches `ai.json`, so an ACP name returns 404 "Unknown server". No UI exposes
  this today, but a future "Test" button would 404.
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

### 9(a) Hand-edited `config/acp.json` with no Settings UI — acceptable, or does it break "just another provider"?

**It breaks the provider-management experience, but not the chat experience, and
the break is deliberate.**

- The security reason is sound and stated in the code (`app.py:1182-1185`): a blob
  any authed client can POST must never choose a command to execute. A "just
  another provider" Settings tab would reintroduce exactly the LAN writable-RCE
  surface the plan set out to avoid.
- What the owner loses: discovering the feature, adding a second agent, editing
  `command`/`args`, testing reachability, and removing it — all now file-editing
  plus a page reload. `ai_probe` cannot test an ACP profile at all (§8).
- **Ambiguity to state, not invent:** the goal lists *four* example agents
  (opencode, Gemini CLI, Claude Code, Goose), but the build supports **one**. If
  the owner only ever wants one, this is fine. If "peer to the OpenAI profiles"
  implies several, the single-object config is a scope gap, not a style choice.
- **Verdict:** acceptable as a deliberate, security-motivated decision for a
  single agent. It is not "just another provider" in configuration; it is "just
  another provider" only in selection and streaming. If the owner wants to switch
  agents casually, the file edit will feel wrong.

### 9(b) Only prose, no thought/tool progress — acceptable for an agent running its own multi-step tools?

**Acceptable as a first cut; it is the weakest part of the feature.**

- The agent may run many tool calls before its first prose, so the owner watches
  a still bubble with no signal that anything is happening. The keep-alive keeps
  the connection open but renders nothing (`app.py:1745`). The Stop button is the
  only feedback that a turn is live.
- This is a presentation gap, not a protocol gap: the ACP client already receives
  thought, tool-call, plan, and usage updates on the event-loop thread and drops
  them by design (`acp_client.py:74-79`). Surfacing them would need a new wire
  vocabulary and rendering, which is why it was deferred.
- For a chat model a silent wait is tolerable. For a coding agent that reads and
  writes files and runs commands, silence removes the owner's ability to notice a
  wrong direction before it is costly.
- **Verdict:** ship-able for short turns; not comfortable for real agentic work.
  If the owner uses this daily, progress rendering should move up the list (§10
  R3).

### 9(c) The trust boundary — will the owner actually be comfortable?

**Only if the deployment context is understood; the design is honest but the
consequence is not documented.**

- The agent runs as the server user with the server user's filesystem access,
  minus whatever the launcher confines. The comment says so (`app.py:1182-1185`)
  and the plan lists it as an accepted limitation (`PLAN.md:404-410`).
- The code auto-allows **every** tool call (`acp_client.py:81-103`), so within a
  turn there is no per-action confirmation. This is coherent for a single-user
  server where the owner can already edit those files in a terminal.
- The part that should give the owner pause: the server is reachable on the LAN
  by default (`./start.sh` binds `0.0.0.0:5000`) and auth is off by default. Under
  those defaults, anyone who can reach the port can trigger an agent run that
  edits files as the server user. That is a materially larger blast radius than
  "chat with a model". `safe_path` does not bound it. The README trust-boundary
  section was not updated (§8), so a reader of the docs will not learn this.
- **Ambiguity to state, not invent:** the design assumes the operator runs with
  auth on and/or a loopback bind, or accepts the exposure. Whether the owner
  actually does is a deployment fact this spec cannot assert.
- **Verdict:** honest and defensible as an operator's decision. Not yet
  *safe-by-communication*: the consequence is in a code comment and a plan, not in
  the README. If the owner runs auth-off on a shared LAN, they should not use it.

---

## 10. Gaps / follow-ups, ranked

1. **Document the trust-boundary change in `README.md` and
   `docs/architecture/ai-assistant.md`; update the `ai.js` header and `agent.md`.**
   *Why:* a security-relevant behaviour change is currently only in a code
   comment and a plan; `PLAN.md` step 7 required it and search shows it is absent.
2. **Stop offering image attachments on ACP, and make a poisoned transcript
   recoverable.** *Why:* the UI accepts images that are always rejected, and the
   image turn stays in `conversation`, so every later ACP turn fails until Clear
   or Edit; the JSON-400 path in `api.js` (`static/js/api.js:111-117`) does not set
   `err.status`, so the existing vision hint never fires.
3. **Render agent progress (thought / tool-call summary) or at least a busy
   signal.** *Why:* a silent multi-step agent turn is indistinguishable from a
   hang; the updates already arrive and are dropped (`acp_client.py:74-79`).
4. **Decide whether one agent is enough and whether a minimal Settings surface
   (add/test/remove without exposing the command) is wanted.** *Why:* the intent
   names several agents; the build supports one and cannot test it.
5. **State that the notebook custom prompt and active-file context do not apply
   to ACP profiles.** *Why:* the Settings prompt is global and a user will
   reasonably expect it to reach whatever provider is selected.
6. **Guard the provider-agnostic tool loop from an ACP agent's prose.** *Why:* a
   `nb-tool`/`nb-edit` fenced block in the agent's output is still parsed
   (`static/js/ai.js:1289`) and could create a card or execute a notebook tool for
   a provider that is supposed to run its own tools.
7. **Document/validate the wrapper form of `command`.** *Why:* `command` is argv[0]
   with no shell, so `"command": "systemd-run --scope opencode acp"` silently
   fails; only `command` + `args` works, and the example does not show it.
8. **Add the missing ACP test cases from §7 (criteria 14, 15, 21, 22, 23, 24).**
   *Why:* the isolation property is well tested; the poisoned-transcript
   recovery, prompt cap, `cwd` resolution, ACP-default, and ACP
   Regenerate/Edit paths are not.

---

## 11. Open questions

1. **One agent or many?** Is a single `config/acp.json` profile the intended
   ceiling, or should the config be a list with a Settings surface for
   add/test/remove? The intent text names several agents. Owner: product + user.
2. **Where is the feature discovered?** With no Settings entry, how does the owner
   learn the ACP option exists and how to configure it — README, the panel, or a
   hint in the picker? Owner: product + `ui-designer`.
3. **Progress rendering scope.** If agent progress is surfaced, which of thought /
   tool-call title / file-changed / command is shown, and does it need the same
   reviewability the notebook's cards have? Owner: product + `architect`.
4. **Deployment assumption.** Does the owner run with auth on and/or a loopback
   bind when using ACP profiles, or accept LAN exposure with auth off? The
   trust-boundary verdict depends on this. Owner: user.
5. **Custom prompt and context.** Should ACP profiles receive the global custom
   prompt and the active-file context in some form (e.g. prefixed into the first
   prompt), or is "the agent brings its own prompt" final? Owner: product.
6. **Regenerate semantics for a stateless agent.** Is "re-run the whole flattened
   transcript in a fresh process" the desired Regenerate meaning, given the agent
   re-reads files and any side effects it already made are not undone? Owner:
   product + user.
