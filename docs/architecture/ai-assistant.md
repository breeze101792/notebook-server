# AI assistant

## Overview

An optional built-in assistant that reads the notebook and proposes edits
for review. It is not a context-free chat: it runs an agentic tool loop,
so it can list and read notes, fetch URLs, search the web, and propose
file changes. Siblings: [backend.md](backend.md) for the server-side
proxy routes and [markdown.md](markdown.md) for the renderer contract the
system prompt documents.

The assistant lives in the ✨ side panel. Its host is
`<div id="ai-view" class="side-panel-view" data-view="ai">` in
`templates/index.html`; `static/js/ai.js` mounts the view, owns the
conversation, and runs the tool loop.

It talks to any OpenAI-compatible `/v1/chat/completions` endpoint through
the server-side SSE route `POST /api/ai/chat`
(`static/js/api.js`, `app.py`). Provider profiles live in
`config/ai.json`. The stored API key is never echoed to the browser
(`_public_ai_config`, `app.py`), but it is attached to the upstream
request sent to whatever `base_url` the saved profile names. All `/api/ai/*`
routes are admin-only **only while auth is on**; because `admin_required`
returns the view unguarded when auth is off (the default), an open server
lets any LAN client read or rewrite the profiles and spend the stored key.
See [Security posture](backend.md#6-security-posture).

## Provider setup

Open Settings → AI. The tab is admin-gated while auth is on, and live.

- Add a provider profile: name, base URL, model, and API key (the AI
  section's element refs start at `settings.js`; the Add-provider
  handler is `settings.js`).
- Mark one profile as the default (`make default`), or Edit and Remove a
  profile.
- Test a profile: the `Test` button calls `GET /api/ai/probe?server=<name>`
  and reports reachable or unreachable. An upstream HTTP error, including
  401, counts as reachable; only a connection failure reports unreachable
  (`app.py`).
- Custom prompt: global text appended to the built-in contract. It can
  steer style and focus but cannot invent tools (see `customPromptSuffix()`).
- Web search: sets the SearXNG instance URL. SearXNG is the supported
  search provider; when it is unset or fails, the search tool falls back to
  a keyless Yahoo results page, parsed best-effort from the HTML.

Editing a profile never re-sends the stored key. A blank API key plus
`replaceSecret: true` carries the previous key over server-side
(`app.py`).

## ACP providers

A second provider kind, **Agent Client Protocol (ACP)**, drives an external
coding agent as a subprocess and streams its prose into the same panel. It is
a peer of the OpenAI profiles in the picker only; the execution model is not
the same.

**Config and the picker.** ACP is configured in `config/ai.json`'s `acp`
list, one or more profiles next to the OpenAI-compatible servers. Each profile
names a **known agent by key**; the server resolves the executable and argv from
its own table (`ACP_KNOWN_AGENTS`, `app.py`):

```jsonc
{"acp": [
  {"name": "opencode", "agent": "opencode",
   "model": "ollama/qwen3.8:latest",
   "cwd": "", "env": {}, "default": true, "timeout": 900},
  {"name": "local-agent", "command": "/usr/local/bin/my-agent",
   "args": ["--acp"]}
]}
```

The command line for an allowlisted key lives in the server table, never in a
POSTed body: a config blob any authenticated client can POST must never choose
a command to execute, so the browser may only name a key. A hand-edited file
may carry an explicit `command` + `args` for an agent the table does not know;
that entry is file-owned and the browser cannot edit or name it. `agent` and
`command` are
mutually exclusive — the `command` + `args` form is the escape hatch for an
agent the table does not know. Known keys: `opencode`, `claude`, `codex`,
`gemini`, `goose`, `cursor`, `qwen`, `kimi`, `cline`, `openhands`, `auggie`,
`copilot`, `kiro`. The raw entry is what is stored: an allowlisted `agent` is
resolved to an absolute command when it is read, and loader output is never
written back, so a profile whose agent is not installed right now keeps its
entry in the file.

`model` is optional (≤ 200 characters) and names the agent's own model. After
`session/new`, `acp_client` looks for the session's model config option — the
one whose `category` is `"model"`, else id `"model"` — and applies the value
with `session/set_config_option` (`_model_option`, `_drive`, `acp_client.py`).
An agent that exposes no such option ends the turn with the in-band error
`"ACP agent does not expose a model option"`; a rejected value ends it with
`"ACP agent rejected the configured model"`, and a value the agent does not
actually select ends it with `"ACP agent did not apply the configured model"`. Verified against `opencode acp`,
whose model values look like `ollama/qwen3.8:latest`.

The agent inherits the server's **full environment**, with the profile's `env`
overlaid (the profile wins). `acp_client.run_turn` merges the environment
before spawning; the SDK's spawn transport would otherwise trim the child to a
fixed handful of variables and silently drop agent credentials and XDG paths
(`acp_client.py`).

`load_acp_configs` (`app.py`) validates each entry on its own and returns the
valid profiles; `load_acp_config` is a compatibility wrapper returning the first
profile or `{}`. It never raises. An invalid entry is dropped on its own, so one
typo cannot disable the other profiles; duplicate names keep the first entry; a
name that collides with an `ai.json` profile is dropped so the API profile keeps
the name (the ACP branch could never run for it). Per-entry bounds: `name` ≤ 60
characters, `command` ≤ 300, `args` ≤ 32 entries of ≤ 1000 characters each,
`cwd` a string (empty means the active workspace root), `env` a
string-to-string map, `model` ≤ 200 characters, `default` a boolean, `timeout`
a finite positive number (default 900 s). An `agent` must name a table entry and
must not be set alongside `command`; if the selected agent's executable is not
on `PATH` that entry is not usable, so a missing agent never yields a picker
entry that always errors. The feature is off when no valid profile remains.

`GET /api/ai/config` returns every stored profile in file order in an `acps`
array as `{name, model, hasModel, agent, default, available, editable}`;
`model` is the configured model or the fallback label `"ACP"`, and `acp`
carries the first **available** entry (or `null`) for older clients.
`command`, `args`, `env`, `cwd`, and `timeout` stay server-side. `available` is
false when the loader would reject the entry — typically because the agent's
executable is not on `PATH`; the profile is still listed, still saved back, and
still editable. `editable` is false for an entry the browser cannot express: a
non-empty `command`, an entry with neither form, or an `agent` key this server
does not recognise. The `default` flag is computed from the resolved default
provider (`_resolve_default_provider`, `app.py`): a stored `ai.json` `default`
that names a saved server or an ACP profile wins; otherwise the first profile
flagged `default: true`; otherwise `""` and the frontend falls back to the first
entry. It may therefore name an unavailable profile. A default chosen in
Settings therefore wins without the server rewriting the file. It also returns
an always-present `acpAgents` array — `[{key, label, available}]`, built by a
read-only `shutil.which` PATH lookup (`_detect_acp_agents`, `app.py`) — so the UI
can show which known agents the host can launch; an agent whose wrapping CLI is
present but whose ACP adapter is missing gains `adapterMissing: true` and a
`hint` install command (today Claude Code and Codex). `loadAiConfig` appends
every `acps` entry whose `available` is not false as an option labelled
`<name> · <model>` after the OpenAI profiles, tags each client-side with
`acp: true`, and selects `cfg.default` when it names a listed provider
(`static/js/ai.js`).

Settings → AI edits the ACP profiles. One row per stored profile carries the
name, a `Default` tag or a `Make default` action, an inline model field, a
status tag (`not installed`, `server-local`) and, for a browser-owned entry, a
`Remove` action; the add form offers a launchable agent no profile has claimed
(`buildAiAcpSection`, `buildAiAcpProfile`, `buildAcpAddForm`,
`static/js/settings.js`). A row whose agent is not installed is listed but
cannot be picked in the chat panel. A file-owned row is read-only: it keeps its
`server-local` tag and no `Remove`. "Make default" posts `default: <profile
name>`; it never writes a per-profile flag.

`POST /api/ai/config` accepts an optional `acp` list of
`{name, agent, model, default}` — those four keys only. Any other key
(`command`, `args`, `env`, `cwd`, `timeout`) is 400. An omitted `acp` leaves
the stored list untouched, which is what every save path predating ACP editing
relies on. A hand-owned entry is preserved verbatim and never dropped; a body
entry that reuses its name is 400; editing a browser-owned entry keeps its
stored `cwd`, `env` and `timeout`. With auth off, a body that carries `acp`
from a non-loopback peer, or with an `X-Forwarded-For` or `X-Real-IP` header, is
403 `loopback_required` (`_acp_write_allowed`, `app.py`): creating a profile is
the one thing this route can do that driving an existing agent cannot. A
prefs-only save from the same client still succeeds. The list is read on every
request, so an edit takes effect on the next send without a restart.

A legacy `config/acp.json` is folded into `ai.json`'s `acp` list once at
startup (`_migrate_acp_file`, `app.py`) as raw entries — a name already stored
is not copied again — and then renamed `acp.json.migrated`. The renamed file is
kept for a rollback and is no longer read. An unreadable `acp.json`, or an
`ai.json` that exists but cannot be parsed, skips the migration with a warning
and leaves both files alone.

**One turn.** `POST /api/ai/chat` serves ACP when the posted `server` is not
an OpenAI profile but matches an ACP profile (`ai_chat`, `app.py`).
Messages are validated by the same `_validate_chat_messages` used by the
OpenAI relay, then system messages are dropped, the newest user message's
`image_url` parts are re-wrapped as ACP `image` content blocks, and the
surviving user/assistant turns are flattened into one prompt —
`"User: …"` / `"Assistant: …"` blocks joined by blank lines
(`_flatten_acp_prompt`, `app.py`) — capped at 8 MiB of text. `_acp_prompt_images`
walks back to the newest user message that carries an image part, so a tool
follow-up appended after the image turn cannot hide it; it validates the data
URL (png/jpeg/webp/gif, canonical base64, non-empty, 4 MiB per image, 12 MiB
per turn) and returns `(mime, base64)` pairs. On the client,
`buildRequestMessages` keeps image parts only on the newest genuine user turn
and collapses older image-bearing messages to their text, so the request body
does not grow with history (`activeServerIsAcp` / `buildRequestMessages`,
`static/js/ai.js`). The agent's advertised `promptCapabilities.image` is not a
gate: the block is sent regardless, and a `false` flag only chooses the error
wording when the prompt fails or is refused (a deliberate deviation from the
ACP client rule, for parity with the OpenAI path). Multi-turn context is the
replayed transcript, exactly as for a model. `acp_client.run_turn` spawns a
fresh agent process per
request (`initialize → session/new → prompt`), kills it at turn end, and
streams `agent_message_chunk` text back as OpenAI delta frames plus
`data: [DONE]`. When the profile sets `model`, the client applies it to the
session's model config option between `session/new` and `prompt` (`_drive`,
`acp_client.py`). Each `tool_call` update the agent starts becomes a namespaced
`data: {"acp":"trace","text":…}` frame that the panel renders as a trace line,
so a long multi-step turn shows activity; thought, plan, and usage updates are
dropped (`acp_client.py`). The prompt is prefixed with a short preamble
(`_acp_context_preamble`, `app.py`) built from server state: the fixed
`ACP_CONTEXT_PREAMBLE` lead, the user's open note (`config/state.json`
`states.<id>.activeFile`), and the global custom prompt (`config/ai.json`
`custom_prompt`).
It is re-sent on every turn, so it is never duplicated into the transcript.

The notebook's `nb-tool` contract is never sent to the ACP agent, because the
system message is dropped. `runToolLoop` is not branched for ACP, however, so
it still scans the agent's reply for fenced `nb-tool` / `nb-edit` blocks: a
fence that the agent emits in its own prose would still be parsed. In normal
use the agent answers in prose and the loop runs a single round.

**Trust and capabilities.** `acp_client.py` is imported lazily, so a missing
`agent-client-protocol` package disables only ACP and degrades to an in-band
SSE error (`app.py`). The client advertises no `fs/*`, `terminal/*`, or
elicitation capability; those client methods raise JSON-RPC
`method_not_found` rather than returning a bogus empty success
(`acp_client.py`). `session/request_permission` is auto-allowed with
the agent's one-shot `allow_once` option, or `allow_always`, or denied when
neither is offered (`acp_client.py`). A spawn failure becomes the
generic `"ACP agent failed to start"`; the configured command line is logged,
never sent to the browser (`acp_client.py`). The agent runs as the
server user with filesystem access, and its own tools execute directly —
`safe_path` and the notebook's approval cards do not apply to it.

**Known limitation.** The notebook's system message is dropped server-side, so
the agent uses its own system prompt; the notebook can only rebuild the custom
prompt and the open-note hint from server state (above), and it does so through
the preamble rather than by forwarding the system turn. Only the newest user
turn's images reach the agent, and the agent's capability flag is not a gate.
The agent's streamed prose and its tool-activity trace lines are rendered; its
thoughts and plans are not.

## The six tools

The tools are declared in `systemPrompt()` and
called by the model as fenced ` ```nb-tool ` JSON blocks.

| Tool | What it does | Runs |
| --- | --- | --- |
| `list` | Enumerates the note tree. | automatically, shown as a trace line |
| `read` | Fetches one note's content. | automatically |
| `fetch` | Fetches a URL server-side via `/api/ai/fetch`, which is CORS-safe. | automatically |
| `search` | Queries the web via `/api/ai/search`: the configured SearXNG instance first, else a keyless Yahoo results-page fallback. | automatically |
| `write` | Creates a NEW file. | needs permission (Apply/Reject card) |
| `patch` | Edits an existing file through a batch of `/api/edit` ops. | needs permission (Apply/Reject card) |

**Search providers.** SearXNG is the supported provider: configure an
instance and `/api/ai/search` queries its JSON output. The keyless fallback
is best-effort — it fetches Yahoo's results page with a browser User-Agent
and parses the result markup, so a change on Yahoo's side breaks it. It
exists so search works with no setup, not as a guarantee. With no instance
configured, every query leaves the machine to `search.yahoo.com` from the
server, including anything the model puts in the query text.

The model's own rules, stated in `systemPrompt()`:

- To update an existing file it MUST use `patch`. A `write` call on an
  existing path is blocked client-side.
- In a patch, `find` must match the file exactly and appear exactly once,
  whitespace included.
- Read the relevant files before proposing patches; never invent content.
- One logical change per patch call; several calls are fine.

## The tool loop

`send()` (with `runToolLoop()`) runs a bounded loop around the SSE relay:

1. The user message is appended and sent with the full conversation.
2. The assistant reply streams in. Any ` ```nb-tool ` blocks are parsed out
   (`collectFenced(text, "nb-tool")`).
3. Read-only tools (`list`, `read`, `fetch`, `search`) run immediately and
   their results are pushed back as tool-result user messages, so the
   model continues in the next round.
4. `write` and `patch` become permission cards (`makePatchCard()` /
   `makeWriteCard()`). The
   loop stops there until the user clicks Apply or Reject, so a card is
   never left behind a completed turn.
5. `MAX_TOOL_ROUNDS = 5` caps the fan-out per user
   turn.

When the model returns prose with no tool blocks, the turn ends.

### Regenerate / Retry / Edit

Once a turn finishes — succeeded, errored (provider rejection or network),
or stopped — the newest turn carries two controls: the newest assistant
bubble gets a **↻ Regenerate** footer button, and the newest genuine user
bubble gets a **✎ Edit** button. They share a `.ai-turn-control` marker
class and the disable logic (`updateTurnDisabled`).

**Regenerate** (`regenerate` in `static/js/ai.js`) re-runs the model on the
latest genuine user turn and replaces that turn's assistant reply.

- The user turn is re-sent unchanged, so an image-bearing turn keeps its
  image parts and a provider rejection can be retried after a model switch
  or a config fix (§10 R1).
- The replaced reply is discarded in full: `conversation` is sliced to the
  anchor turn and `clearLastTurnDom()` drops the whole DOM tail (reply,
  trace lines, errors, cards), so the regenerated request never carries the
  previous answer or its tool round. Only the retry instruction below is
  added.
- `regenerating` is true for the whole regenerate turn (every tool round),
  and `getSystem()` appends `AI_RETRY_INSTRUCTION` to an uncached copy of
  the system turn: the same prompt otherwise makes the model reproduce the
  answer it just gave. The hint never names or contains the discarded
  reply, and it is cleared before the next normal send (or by Clear).

**Edit** (`editLastMessage`, exposed as `NB.ai.editLastMessage`) drops the
last turn and restores its input to the composer for editing:

- It removes the user bubble and everything after it, trims `conversation`
  to `slice(0, lastUserTurnIndex())` (before the user turn), then puts the
  last sent prompt back in the textarea, focuses it, and restores the last
  sent attachments into the pending bar (`restoreAttachments`). It never
  auto-sends — the user edits and presses Send.
- `restoreAttachments` rebuilds the chips (text and image thumbnails) and
  the slot/byte reservations from the already-read entries, without
  re-reading or re-decoding. The entries come from module state
  (`lastSentPrompt` / `lastSentFiles`, captured in `send()`), never from
  the conversation: conversation entries serialize into the request body,
  so extra keys there would duplicate an image's base64.
- Edit does not silently discard work: because `restoreAttachments` clears
  the attach bar and `composerSetPrompt` overwrites the textarea, the Edit
  control is disabled whenever the composer holds a non-empty draft or any
  pending attachment chips (title: "Clear the draft and attachments
  first"), and re-enables once the draft is emptied/sent and the chips are
  removed. Regenerate is unaffected by this guard.
- Edit is a no-op — and both controls are disabled — while a request is in
  flight, while attachment reads are pending, or while a write/patch
  permission card is unresolved; resolving the card re-enables them.
- After Edit trims the tail, the now-newest previous turn has no controls;
  `restoreTurnControls()` re-adds both (removing any existing set first).

Shared behavior:

- Only the newest turn has controls: `runToolLoop()` calls
  `removeTurnControls()` before every new turn (send, regenerate, or edit
  via `clearLastTurnDom`), stripping any existing `.ai-turn-control`.
- Replacing a turn clears the **whole DOM tail** after the last user
  bubble, not just `.ai-msg` nodes. `runAutoTool` appends `.ai-tool-trace`
  lines directly to the log, so a Regenerate that removed only `.ai-msg`
  siblings left stale duplicate trace lines; `clearLastTurnDom()` removes
  every sibling (assistant bubbles, traces, errors, cards, controls). It is
  shared by Regenerate (keeps the user bubble) and Edit, which additionally
  removes the user bubble itself (`clearLastTurnDom(log, true)`) since the
  next send re-creates it.
- `lastUserTurnIndex()` finds the turn structurally: every tool follow-up
  and `recordToolOutcome` push goes through `pushToolMessage()`, which tags
  the entry in a module-level `toolMessages` WeakSet. The index returns the
  last `role: "user"` entry not in that set, so a genuine prompt whose text
  merely starts with "(tool " is no longer misclassified. The WeakSet adds
  nothing to the entry, so the wire body stays `{role, content}`, and a
  content-part array (an image turn) is never tagged, so it is always
  genuine.
- Every tool round re-checks the wire cap (`wireSizeOfMessages()`) before
  sending; an oversize request (e.g. a near-limit image turn that grew with
  tool follow-ups) shows the too-large error and stops the turn without
  sending. Regenerate inherits this through `runToolLoop()`.

## Reviewing edits

Nothing is written until the user clicks Apply. `write` and `patch` always
surface as Apply/Reject cards.

- A patch card shows the proposed ops and a color-coded diff with dual
  line numbers and a `@@` hunk header (`buildDiffEl()`).
  The diff is a client-side preview computed by `previewPatch()`,
  which simulates the literal `find_replace`,
  `append`, and `prepend` ops. Ops it cannot simulate show an ops summary
  instead of a diff.
- Applying a patch calls `/api/edit` (`file_edit` route, `app.py`).
  The server re-reads the file and re-applies every op against the
  current content, so a stale `find` (zero matches) fails closed with
  HTTP 400 (`_edit_find_replace`'s zero-match raise at `app.py`,
  mapped to 400 at `app.py`) and the card turns errored. The
  client preview is advisory; the server is the authority.
- Applying a `write` calls `/api/create`. The path is normalised to a note
  path before the card renders (`NB.sidebar.normaliseNotePath`): the tree
  lists only `.md`, so `notes/chapter` creates `notes/chapter.md`. If the
  target already exists, the card is blocked with "write cannot overwrite —
  ask the AI to patch it instead" (`makeWriteCard`'s apply handler re-reads
  the path and blocks on a readable file).
- Applying emits `NB.evt("ai:applied", {path, data})`. The viewer refreshes
  its cache from that event and records a self-save so the watcher does not
  raise an "external change" prompt. An open edit session is preserved:
  source edit mode loads the patched bytes into CM6 and WYSIWYG re-renders
  in place, so neither refresh goes through the view-mode path that hides
  the edit bar.
- Rejecting records the outcome in the conversation so the model knows the
  proposal was declined.

## Message rendering

An assistant reply renders with the same pipeline as a note: marked in GFM
mode for the prose, highlight.js for code fences, and `NB.blocks.renderAll`
for the special fences (`mermaid`, `wavedrom`, `math`, `graphviz`,
`html-live`, `svg`). The block pass runs per bubble, debounced 400 ms while
a reply streams and immediately when the turn ends, because every delta
re-renders the prose and a diagram rendered mid-stream would be discarded
by the next delta. A reply whose fence is still open is not enriched, so a
half-written diagram never runs the parser or raises its error toast.
Restored history enriches each bubble the same way.

The reply is model output, not the user's own file, so the pass runs
`renderAll(container, { untrusted: true })`. A descriptor that declares
`untrustedSafe: false` is skipped there; today that is `wavedrom`, whose
source parser falls back to `eval` for WaveDrom's unquoted keys. A
```wavedrom fence in a reply therefore stays a highlighted code block, and
the note viewer still renders it as a diagram. Making the WaveDrom parser
JSON-only would lift the exclusion.

The reply HTML is untrusted, so it is sanitized before it enters the panel:
`marked.parse()` feeds the vendored DOMPurify 3.4.12 (`static/vendor/
purify.min.js`) with `AI_SANITIZE_CONFIG`, which forbids script, style,
frames, forms, and `javascript:` URLs while keeping the markdown shapes,
task-list checkboxes, and wikilink data attributes. A missing bundle fails
closed: the reply renders as plain text. Model-authored `svg` and `dot`
output is sanitized separately after rendering (`AI_SANITIZE_SVG_CONFIG`),
because those renderers build their own `<svg>` from the fence source.

Rendered blocks in the panel keep the note affordances: the shared figure
sizing fits each diagram to the chat log (not to `#viewer-content`), the
copy buttons come from the same `copy-image.js` owner, and clicking a
diagram opens its lightbox. The `nb-tool` and `nb-edit` fences are stripped
before rendering, so a tool call never appears as a block.

## Conversation memory

`ai.js` owns the full transcript in `conversation`: the system prompt,
every user turn, every assistant reply, and every tool result.
Every request re-uploads the whole history (`runToolLoop()`), so follow-ups
keep context without re-reading files. Applied, rejected, and blocked
outcomes are appended through `recordToolOutcome`, so the model sees what
happened to its proposals.

### Chats

`conversation` is the **active chat's** live array. Chats are browser-local
and per file: one chat belongs to the note it was started from, and the
panel's bar and manager switch between them. There is no server API and no
server persistence for chats.

The store is one `localStorage["nb:aiChats"]` key, version 1:

```jsonc
{
  "v": 1,
  "activeId": "c...",          // the active chat, "" when none
  "chats": [{
    "id": "c...",              // "c" + base36 Date.now() + random suffix
    "file": "notes/a.md",      // notebook path; "" = Unfiled
    "title": "New chat",       // derived, or manual once renamed
    "custom": false,           // true once the user renamed it
    "createdAt": 0,
    "updatedAt": 0,
    "conversation": [{ "role": "user", "content": "..." }],
    "toolFlags": [false],      // parallel; true = tool follow-up
    "lastPrompt": ""
  }]
}
```

- **Validation.** A store that fails the shape check (version, types, role
  whitelist, entry arrays, a finite timestamp, an id of `[A-Za-z0-9_-]{1,64}`,
  no duplicate ids) is dropped and the panel starts empty, the same policy
  the single-transcript key had. A dangling `activeId` resets to `""`
  without touching the chats.
- **Migration.** The legacy `nb:aiChat` transcript (`{v, conversation,
  toolFlags, lastPrompt}`) is imported once as a chat bound to the file open
  at load, titled from its first genuine prompt (else `Imported chat`); the
  old key is removed only after the new store has written.
- **Writing.** `persistHistory()` keeps its name and now writes the whole
  store. It first syncs the active chat (`conversation` is reassigned by
  `.slice()` in regenerate and edit), derives `toolFlags` from the
  `toolMessages` WeakSet, and derives a title from the first genuine user
  prompt while the chat is still `New chat` and not `custom`. `updatedAt`
  moves only when the conversation or the title changed, so switching chats
  (which persists `activeId`) never reorders the list.
- **Switching.** `activeChat()` is the chat with the store's `activeId`.
  Switching assigns `conversation = chat.conversation`,
  `lastSentPrompt = chat.lastPrompt`, clears `lastSentFiles`, and drops
  `systemCache`, so the system prompt names the active chat's file (falling
  back to the viewer's) and the restored transcript keeps Regenerate/Edit
  correct. Every chat's tool entries are tagged into `toolMessages` on load,
  not just the active one. Attachments are per session: a turn restored from
  storage, or reached by switching chats, cannot rebuild its attachment chip
  list, so Edit is disabled for it rather than resending without them.
- **Budget.** The whole store shares one 4 MiB budget
  (`AI_CHATS_MAX_BYTES`; the copy is derived from it). Over it, image data
  URLs are rewritten to the existing text placeholder — other chats oldest
  first, then the active one — and the write is skipped if even that does
  not fit, leaving a flag the manager reports. A chat is never deleted to make room; deleting the last
  chat is what removes the key. The manager's storage line reports the size
  of the last successful write (a staged copy can be smaller than memory),
  and a quota rejection raises the same warning as an over-budget skip.
- **Viewer sessions.** The AI API is admin-only, so a viewer session neither
  restores the store nor writes it, and the bar and manager stay hidden.
- **Rename and move.** A `file:moved` event re-keys every chat bound to the old
  path, or under it when a folder moved, and writes the store; the chat follows
  the note and the next turn's system prompt names the new path. The followed
  path and a queued `file:open` switch are re-keyed the same way, so a rename
  during a turn does not strand them on the old path.

### Attachments

The user can attach local text files and images to a message. Both kinds
share one pending chip list (max 8 chips).

- **Text files** are read, BOM-decoded, and inlined into the user turn as
  `[Attached file: …]` blocks. Caps: 128 KiB per file, 512 KiB total. A
  NUL byte rejects the file as binary.
- **Images** (PNG/JPEG/WebP/GIF; SVG stays text) are read and
  downscaled/re-encoded locally in the browser by `readImageAttachment`.
  The policy: probe the bytes to confirm a real
  image and reject above 40 MP; pass the original bytes through when the
  file is ≤ 768 KiB and its longest edge ≤ 1568 px; otherwise re-encode
  with the longest edge at 1568 px (PNG→PNG, JPEG/WebP→same at q0.85,
  GIF→PNG first frame), retry once at 1024 px / q0.75 if still over
  768 KiB, then reject above 2 MiB. Max 4 images per message. The canvas
  mechanics sit behind an
  overridable codec seam (`NB.ai._setImageCodec` / `NB.ai._resetImageCodec`)
  so jsdom tests stub the canvas.
- **Wire format.** A turn with no images keeps a plain-string `content`. A
  turn with images uses an OpenAI content-part array: one `text` part
  (prompt + text inlines) when there is text, then one `image_url` part per
  image (`composeUserContent`). Image data URLs
  carry the sniffed output MIME, never the filename.
- **Persistence.** The full content, base64 image parts included, is
  re-uploaded every turn and every tool round. `Clear` empties the active
  chat's copy of it.
- **Wire backstop.** `send` refuses a request whose serialized body would
  exceed 12 MiB before calling the API, without mutating the conversation;
  the same check runs in the submit handler before the pending chips are
  cleared, so a refused send keeps what the user attached.

An upstream rejection of an image-bearing turn (HTTP status ≥ 400) shows
"this model may not support image input"; the image parts stay in the
conversation so a retry or a model switch still carries them.

The **Clear** button aborts an in-flight turn, empties the active chat's
conversation, system cache, log and attachments, and keeps the chat and its
title (the `clearBtn` handler in `mount()`). It is disabled when there is no
active chat or the chat is already empty with no attachment chips. Opening a
file switches the panel to that file's newest chat, or to no active chat;
the system prompt is invalidated on `file:open`, which also carries the
switch (the `NB.evt.on("file:open")` hook in `mount()`). A switch that
arrives mid-turn waits for `ui.end()`.

## Configuration

`config/ai.json` uses snake_case keys; the HTTP API accepts camelCase input
and returns camelCase keys (the mapping lives in the AI section of `app.py`,
from `app.py`).

```jsonc
{
  "servers": [
    {"name": "local", "base_url": "http://localhost:11434",
     "api_key": "", "model": "llama3"}
  ],
  "default": "local",
  "custom_prompt": "",
  "searxng_url": ""
}
```

- `GET /api/ai/config` returns the masked profile list with `hasKey`
  booleans, the default, the custom prompt, and the SearXNG URL. The
  stored key is never echoed (`app.py`).
- `POST /api/ai/config` replaces the profile list. Base URLs are
  normalized on save: a trailing slash and a trailing `/v1` are stripped
  (`app.py`). `_chat_url()` then appends
  `/v1/chat/completions` (`app.py`).
- `customPrompt` is preserved when the POST omits it and cleared when sent
  as `""`. The cap is 8000 characters (`app.py`).
- `searxngUrl` is preserved when omitted and cleared when sent as `""`
  (`app.py`).

Caps:

- `fetch` — 512 KiB body, 15-second timeout
  (`AI_FETCH_MAX_BYTES` at `app.py`, `AI_FETCH_TIMEOUT` at
  `app.py`).
- `search` — top 10 results from either provider; 15-second SearXNG
  timeout, 20-second fallback timeout, 1 MiB body
  (`AI_SEARXNG_MAX_RESULTS`, `AI_SEARXNG_TIMEOUT`,
  `AI_FALLBACK_SEARCH_TIMEOUT`, `AI_SEARCH_MAX_BYTES` at `app.py`).

Upstream HTTP errors during chat are re-emitted in-band as SSE
`event: error` frames, so the browser can display them
(`app.py`). The client treats an `{error: true}` frame as a
failed call (`static/js/api.js`).

The full HTTP request/response shapes for every `/api/ai/*` route are in
[`../contracts/http-api.md`](../contracts/http-api.md); the `config/`
file layout is in [`../contracts/configuration.md`](../contracts/configuration.md).

## Worked examples

### "Summarize what's in this folder"

The model calls `list` followed by `read` on the notes it found. Both run
automatically. Their outputs are fed back as tool results, and the final
round is a prose summary. No permission card appears, and nothing is
written.

### "Add a 'Next steps' section to notes/plan.md"

1. The model calls `read` on `notes/plan.md` (automatic).
2. It emits a `patch` call with an `append` op. A permission card appears
   showing the diff.
3. The user clicks Apply. The client posts the batch to `/api/edit`; the
   server verifies the anchor, applies atomically, and returns. The card
   shows "Applied", the viewer refreshes, and the watcher stays quiet.

### "Create a new note for the deployment runbook"

1. The model calls `list` to see where notes live (automatic).
2. It emits a `write` call with the full content. A permission card shows
   the whole file as added lines.
3. The user clicks Create. The client calls `/api/create`. If the path
   already exists the card errors and tells the user to ask for a patch
   instead.

### "Search the web for the current Graphviz release and add it to notes/tools.md"

1. The model calls `search` (automatic). It queries the configured SearXNG
   instance when there is one and otherwise the keyless Yahoo results-page
   fallback, so search works with no setup; the trace line names the engine
   that answered.
2. It may call `fetch` on a result URL (automatic, server-side,
   CORS-safe).
3. It proposes a `patch` on `notes/tools.md` with a `find_replace` op. The
   user reviews the diff and applies.