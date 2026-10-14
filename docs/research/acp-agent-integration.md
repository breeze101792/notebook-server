# ACP: what it means when wiring an external coding/LLM agent into a web app

Researched 2026-10-13. All external sources read directly; URLs and page titles
are given. Claims are tagged **[observed]** (read in a source), **[inferred]**
(conclusion drawn from sources), or **[assumption]**. Where the sources do not
settle a question it is marked **[not established]**.

---

## Question

Establish, with citations to primary sources, what "ACP" means in the context of
wiring an external coding/LLM agent into a web app's chat backend. The candidate
was the "Agent Client Protocol" by Zed Industries (agentclientprotocol.com),
used by the Zed editor to talk to external agents such as Gemini CLI, Claude
Code, and Goose. Alternative expansions ("Agent Communication Protocol" from
IBM/BeeAI, and others) had to be disambiguated.

---

## Finding

**[observed]** In the ecosystem of "external coding agents" — the tools named in
the request (Gemini CLI, Claude Code, Goose) — the established meaning of *ACP*
is the **Agent Client Protocol**, published at `https://agentclientprotocol.com`
and in `https://github.com/agentclientprotocol/agent-client-protocol`. It is a
JSON-RPC 2.0 protocol that standardizes communication between *code editors* and
*coding agents*.

**[observed]** The other widely cited "ACP", **Agent Communication Protocol**,
is a different protocol from IBM/BeeAI for agent-to-agent (A2A) communication,
is REST/HTTP-based not JSON-RPC, and its repository was archived and folded into
A2A (see "Competing / overlapping standards" below). A third "ACP", **Agentic
Commerce Protocol**, is an e-commerce protocol with no relation to coding
agents.

**[inferred]** For the specific goal "wire an external coding agent into a host
application", the Agent Client Protocol is the one the request is about: it is
the only one of the three that is defined around a host app launching and
speaking to a coding agent.

---

## What the Agent Client Protocol is and what it solves

**[observed]** From the introduction page
(`https://agentclientprotocol.com/get-started/introduction`, fetched as the site
root):

> "The Agent Client Protocol (ACP) standardizes communication between code
> editors/IDEs and coding agents and is suitable for both local and remote
> scenarios."

> "ACP solves this by providing a standardized protocol for agent-editor
> communication, similar to how the Language Server Protocol (LSP) standardized
> language server integration."

> "ACP is suitable for both local and remote scenarios:
> - **Local agents** run as sub-processes of the code editor, communicating via
>   JSON-RPC over stdio.
> - **Remote agents** can be hosted in the cloud or on separate infrastructure,
>   communicating over HTTP or WebSocket"

> "Full support for remote agents is a work in progress. We are actively
> collaborating with agentic platforms to ensure the protocol addresses the
> specific requirements of cloud-hosted and remote deployment scenarios."

The problem it solves, quoted from the same page: without it, "Each editor must
build custom integrations for every agent they want to support, and agents must
implement editor-specific APIs to reach users", causing "Integration overhead",
"Limited compatibility", and "Developer lock-in".

**[observed]** The architecture page
(`https://agentclientprotocol.com/get-started/architecture`) states the design
principles: "MCP-friendly" (built on JSON-RPC, re-uses MCP types where possible),
"UX-first", and "Trusted" — "ACP works when you're using a code editor to talk
to a model you trust. You still have controls over the agent's tool calls, but
the code editor gives the agent access to local files and MCP servers."

---

## Transport and framing

**[observed]** Protocol overview
(`https://agentclientprotocol.com/protocol/v1/overview`):

> "The protocol follows the [JSON-RPC 2.0](https://www.jsonrpc.org/specification)
> specification with two types of messages:
> - **Methods**: Request-response pairs that expect a result or error
> - **Notifications**: One-way messages that don't expect a response"

**[observed]** Transports page
(`https://agentclientprotocol.com/protocol/v1/transports`):

> "The protocol currently defines the following transport mechanisms ... 1.
> stdio, communication over standard in and standard out 2. *Streamable HTTP
> (draft proposal in progress)*
> Agents and clients **SHOULD** support stdio whenever possible."

The stdio framing is specified precisely:

> "The client launches the agent as a subprocess."
> "The agent reads JSON-RPC messages from its standard input (`stdin`) and sends
> messages to its standard output (`stdout`)."
> "Messages are individual JSON-RPC requests, notifications, or responses."
> "Messages are delimited by newlines (`\n`), and **MUST NOT** contain embedded
> newlines."
> "The agent **MAY** write UTF-8 strings to its standard error (`stderr`) for
> logging purposes."
> "The agent **MUST NOT** write anything to its `stdout` that is not a valid ACP
> message. The client **MUST NOT** write anything to the agent's `stdin` that is
> not a valid ACP message."

The page also says custom transports are allowed ("The protocol is
transport-agnostic and can be implemented over any communication channel that
supports bidirectional message exchange"), provided they preserve the JSON-RPC
message format.

**[observed]** The long-lived HTTP/WebSocket transport is an active but
*draft* RFD, not a shipped stable transport:
`https://agentclientprotocol.com/rfds/streamable-http-websocket-transport`.
Its "Status quo" section states: "ACP only has stdio. There is no standard remote
transport, which causes fragmentation as implementers invent their own HTTP
layers, leading to incompatible SDKs and deployments." Its revision history entry
of **2026-07-02** says it "Moved to Active to reflect current Transports Working
Group focus." It proposes a `/acp` endpoint with **Streamable HTTP**
(POST + long-lived SSE GET streams, HTTP/2 required) and a **WebSocket upgrade**,
and states it is "targeted for inclusion in **v1** as an additive feature".

**[observed]** Message shape examples (quoted verbatim from the docs):

- `initialize` request (`protocol/v1/initialization`):
```json
{ "jsonrpc": "2.0", "id": 0, "method": "initialize",
  "params": { "protocolVersion": 1,
    "clientCapabilities": { "fs": { "readTextFile": true, "writeTextFile": true }, "terminal": true },
    "clientInfo": { "name": "my-client", "title": "My Client", "version": "1.0.0" } } }
```
- `session/update` notification (`protocol/v1/prompt-turn`): a JSON-RPC
  notification (no `id`) with `method: "session/update"` and
  `params: { sessionId, update: { sessionUpdate: "<variant>", ... } }`.
- Permission request (`protocol/v1/tool-calls`): `session/request_permission`
  with `params: { sessionId, toolCall: { toolCallId }, options: [...] }`, answered
  with `result: { outcome: { outcome: "selected", optionId: "..." } }` or
  `{ outcome: "cancelled" }`.

**[observed]** Conventions (`protocol/v1/overview`): "All file paths in the
protocol **MUST** be absolute. Line numbers are 1-based." Error handling follows
standard JSON-RPC 2.0 ("Successful responses include a `result` field; Errors
include an `error` object with `code` and `message`; Notifications never receive
responses").

---

## Lifecycle

**[observed]** Message flow (`protocol/v1/overview`), quoted:

1. **Initialization** — "Client → Agent: `initialize` to establish connection";
   "Client → Agent: `authenticate` if required by the Agent".
2. **Session Setup** — "Client → Agent: `session/new` to create a new session" or
   "`session/load` to resume an existing session if supported".
3. **Prompt Turn** — "Client → Agent: `session/prompt` to send user message";
   "Agent → Client: `session/update` notifications for progress updates"; "Agent
   → Client: File operations or permission requests as needed"; "Client → Agent:
   `session/cancel` to interrupt processing if needed"; "Turn ends and the Agent
   sends the `session/prompt` response with a stop reason".

Baseline agent methods: `initialize`, `authenticate`, `session/new`,
`session/prompt`. Optional: `session/load`, `logout`, `session/set_mode`.
Baseline client method: `session/request_permission`. Optional client methods:
`fs/read_text_file`, `fs/write_text_file`, `terminal/create`, `terminal/output`,
`terminal/release`, `terminal/wait_for_exit`, `terminal/kill`,
`elicitation/create`. Client notification: `session/update` (and
`elicitation/complete`).

**[observed]** Capabilities are negotiated in `initialize` and are all optional
by default:

> "All capabilities included in the `initialize` request are **OPTIONAL** ...
> Clients and Agents **MUST** treat all capabilities omitted in the `initialize`
> request as **UNSUPPORTED**." (`protocol/v1/initialization`)

Client capabilities quoted from the same page: `fs.readTextFile`,
`fs.writeTextFile`, `terminal`, `auth.terminal`, `elicitation`, and
`session.configOptions.boolean`, `session.compaction`, `session.notices`.
Agent capabilities: `loadSession`, `promptCapabilities`
(`image`/`audio`/`embeddedContext`), `mcpCapabilities` (`http`/`sse`), `auth`,
and session capabilities `delete` / `additionalDirectories`.

**[observed]** Filesystem (`protocol/v1/file-system`): the *client* exposes
`fs/read_text_file` (params `sessionId`, absolute `path`, optional `line`,
`limit`) and `fs/write_text_file` (`sessionId`, absolute `path`, `content`; "The
Client **MUST** create the file if it doesn't exist"). The agent "MUST verify
that the Client supports these capabilities" and "MUST NOT" call a method whose
capability is absent.

**[observed]** Terminals (`protocol/v1/terminals`): `terminal/create` returns a
`terminalId` immediately; `terminal/output`, `terminal/wait_for_exit`,
`terminal/kill`, and `terminal/release` manage it. "The Agent **MUST** release
the terminal using `terminal/release` when it's no longer needed." Terminals can
be embedded in tool calls so the client renders live output.

**[observed]** Permissions (`protocol/v1/tool-calls`): the agent "**MAY** request
permission from the user before executing a tool call by calling the
`session/request_permission` method". Options carry a `kind` of `allow_once`,
`allow_always`, `reject_once`, or `reject_always`. "Clients **MAY** automatically
allow or reject permission requests according to the user settings." On
cancellation the client "**MUST** respond with the `"cancelled"` outcome".

**[observed]** Model selection is now expressed as a **session config option**,
not a dedicated method (`protocol/v1/session-config-options`):

> "Agents can provide an arbitrary list of configuration options for a session,
> allowing Clients to offer users customizable selectors for things like models,
> modes, reasoning levels, and more."

Categories include `mode`, `model`, `model_config`, `thought_level`. The client
changes a value via `session/set_config_option`; the agent responds "with the
complete list of all configuration options and their current values". The older
`modes` API exists but is deprecated: "If an Agent provides `configOptions`,
Clients **SHOULD** use them instead of the `modes` field. Modes will be removed
in a future version of the protocol." The dedicated `session/set_mode` method is
also marked for removal (`protocol/v1/session-modes`).

---

## Local subprocess vs network socket

**[observed]** Stable ACP is **stdio only** in practice: "The client launches the
agent as a subprocess" (`protocol/v1/transports`). Both docs and the architecture
page describe the editor booting "the agent sub-process on demand"
(`get-started/architecture`).

**[observed]** Remote (network) access is documented as intended but **not yet
stable**: the introduction calls remote support "a work in progress"; the
transports page lists Streamable HTTP as a "draft proposal in progress"; the
transport RFD is "Active" as of 2026-07-02 and "targeted for inclusion in v1".

**[observed]** The community has filled the gap with bridges. The clients page
(`https://agentclientprotocol.com/get-started/clients`) lists e.g.
`acp_rpc_bridge` ("bridges stdio-based agents to HTTP ... supports ACP
Streamable HTTP and OpenCode REST API endpoints"), `ACP to AG-UI` ("bridges any
ACP agent to web frontends via AG-UI events over SSE"), and `ACP Remote`
("remote WebSocket transport for ACP agents and clients").

**[inferred]** A web app *server* (Python/Node) can be an ACP client today by
launching the agent as a local subprocess over stdio. A *browser-only* client
cannot, because it has no way to spawn a subprocess or access raw stdio. A
browser front end would need a server-side bridge or one of the remote
transports.

---

## What the host implements vs. what the agent implements

**[observed]** Agent side (server), per `protocol/v1/overview` and
`protocol/v1/initialization`: implement `initialize`, `authenticate` (if auth is
advertised), `session/new`, `session/prompt`, `session/cancel` (notification),
and emit `session/update` notifications; optionally `session/load`, `logout`,
`session/set_mode`. It negotiates capabilities in the `initialize` response and
advertises `authMethods`.

**[observed]** Client side (host app), per the same pages: implement
`session/request_permission` (baseline); optionally `fs/read_text_file`,
`fs/write_text_file`, `terminal/*`, and `elicitation/create`, gated on the
capabilities it advertised. The client owns the UI, user interaction, and
resource access, and launches the agent subprocess.

**[observed]** The official reference material includes SDKs for Rust,
TypeScript, Python, Kotlin, and Java, a JSON Schema, and a Test Compatibility Kit
(`https://agentclientprotocol.com/libraries/testing`; SDK list at
`https://github.com/agentclientprotocol/agent-client-protocol`).

---

## Streaming

**[observed]** Partial output is delivered as JSON-RPC **notifications** named
`session/update`. From `protocol/v1/prompt-turn`, the `sessionUpdate` field
selects the variant:

| `sessionUpdate` value | Description |
| - | - |
| `user_message_chunk` | A streamed chunk of a user message. |
| `agent_message_chunk` | A streamed chunk of the Agent's response. |
| `agent_thought_chunk` | A streamed chunk of the Agent's reasoning. |
| `tool_call` | A new tool call. |
| `tool_call_update` | A change to a tool call's status or results. |
| `plan` | The Agent's execution plan. |
| `available_commands_update` | The set of available slash commands ... |
| `current_mode_update` | The current session mode has changed. |
| `config_option_update` | The session's configuration options have changed. |
| `session_info_update` | Session metadata ... has changed. |
| `usage_update` | The session's context window usage and cumulative cost. |
| `notice` | A live user-facing notice ... |
| `compaction_update` | Creates or updates a context compaction ... |
| `compaction_summary_chunk` | Appends content to a compaction's retained summary ... |

Example `agent_message_chunk` (verbatim):
```json
{ "jsonrpc": "2.0", "method": "session/update",
  "params": { "sessionId": "sess_abc123def456",
    "update": { "sessionUpdate": "agent_message_chunk", "messageId": "msg_agent_c42b9",
      "content": { "type": "text", "text": "I'll analyze your code ..." } } } }
```
"The Agent **MAY** include an opaque, unique `messageId` on message chunks.
Chunks with the same `messageId` belong to the same message; a changed
`messageId` indicates a new message."

**[observed]** The turn terminates with a `session/prompt` response carrying a
`StopReason`: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, or
`cancelled`.

---

## Auth and configuration expectations

**[observed]** ACP authentication is negotiated during `initialize`; agents
advertise `authMethods` (`protocol/v1/authentication`). Default method type is
`agent` (the agent handles its own login); a `terminal` type tells the client to
run the agent program interactively, gated on the client advertising
`clientCapabilities.auth.terminal`. The client calls `authenticate` with the
method ID (never for a `terminal` method). `logout` is optional, gated on
`agentCapabilities.auth.logout`. "After a successful `logout`, new sessions that
require authentication will require the user to complete one of the advertised
authentication flows again." The protocol "does not guarantee what happens to
already-running sessions after `logout`."

**[observed]** Credentials are **not** part of the protocol. From Zed's docs
(`https://zed.dev/docs/ai/external-agents`): External Agents "run through their
own process and provider relationship. Billing, legal terms, retention, and data
handling are between you and the agent provider." The configuration-boundaries
table says model/provider config and auth/API keys/subscriptions are "Usually
owned by the External Agent". Zed configures custom agents in
`~/.config/zed/settings.json` under `agent_servers`, e.g.:
```json
{ "agent_servers": { "my-agent": { "type": "custom", "command": "node",
  "args": ["~/projects/agent/index.js", "--acp"], "env": {} } } }
```

**[observed]** MCP servers are forwarded from the client to the agent inside
`session/new` / `session/load` / `session/resume` (`mcpServers`), and the agent
connects to them; "All Agents **MUST** support [connecting to MCP servers via]
stdio" (`protocol/v1/session-setup`).

---

## Version, stability, and adoption

**[observed]** Current stable protocol version is **1**. The repository README
(`https://github.com/agentclientprotocol/agent-client-protocol`) states:
"**The current stable ACP protocol version is `1`.**" Protocol version is
negotiated in `initialize` as a single integer
(`protocol/v1/initialization`): "This version is only incremented when breaking
changes are introduced."

**[observed]** **v2 is a Draft.** Announcement
`https://agentclientprotocol.com/announcements/acp-v2-draft`, published
**2026-07-20**: "**v2 is a Draft** ... various pieces can, and will, change
before stabilization ... gate your implementation behind the version negotiation
**AND** feature flags. Don't ship it by default in production until we are
closer to stabilization." It also says "Adding v2 support should not mean
dropping v1."

**[observed]** The **Rust and TypeScript SDKs reached 1.0.0** on **2026-06-25**
(`https://agentclientprotocol.com/announcements/sdk-1-0-releases`).

**[observed]** License is **Apache-2.0**; the GitHub repo showed 4.4k stars,
430 forks, 2,412 commits (fetched 2026-10-13).

**[observed]** Real agents listed as implementing ACP
(`https://agentclientprotocol.com/get-started/agents`) include: Claude Agent
(via Zed's SDK adapter), Codex CLI (via ACP's adapter), Gemini CLI, Cline, Cursor,
GitHub Copilot (public preview), Goose, OpenCode, OpenHands, Qwen Code, Kimi CLI,
Kiro CLI, Mistral Vibe, Augment Code, Blackbox AI, Docker's cagent, Junie by
JetBrains, fast-agent, LangChain/LangGraph Deep Agents, and others.

**[observed]** Clients include Zed, JetBrains, Neovim (via plugins), Sublime
Text, Qt Creator, Emacs, Obsidian, VS Code (via extensions), plus web/desktop
clients such as ACP UI, Agent Studio, AionUi, Casper ("A web client for kiro-cli
that talks to it over the Agent Client Protocol"), and others
(`https://agentclientprotocol.com/get-started/clients`). The docs describe ACP
as developed "by JetBrains and Zed" (per the JetBrains ACP landing page surfaced
in search; the primary site says "The ACP is developed openly by JetBrains and
Zed", `https://www.jetbrains.com/acp/`).

---

## Is ACP for browser/web-app backends, or specifically for editors?

**[observed]** The protocol is editor-centric by framing but not editor-exclusive.
`protocol/v1/overview` says: "Clients ... are typically code editors (IDEs, text
editors) but can also be other UIs for interacting with agents." The clients list
includes web clients, PWAs, and browser extensions.

**[observed]** The dominant stable transport is a client launching an agent as a
local subprocess over stdio (`protocol/v1/transports`; `get-started/architecture`).

**[inferred]** ACP is *designed around* a host that can spawn a local process and
mediate filesystem/terminal/permission access — i.e. a native editor or a
server-side host. A web-app backend running server-side fits that model as an ACP
client (launch subprocess, relay `session/update` to the browser). A pure browser
client does not fit without a bridge or the draft remote transport.

**[not established]** Whether the project's own chat backend should use ACP is a
decision for `plan`/`architect`; this report only establishes what ACP is.

---

## Competing / overlapping standards

### MCP — Model Context Protocol (tools, not this)

**[observed]** ACP is built on JSON-RPC and "re-uses MCP types where possible"
(`get-started/architecture`). MCP standardizes agent-to-tool/data access; ACP
standardizes editor-to-coding-agent communication. The IBM comparison page
(`https://www.ibm.com/think/topics/agent-communication-protocol`) describes MCP
as "Designed for enriching a single model's context with tools, memory and
resources. Introduced by Anthropic. *Focus: one model, many tools*."

**[observed]** In practice the two compose: the ACP client forwards MCP server
configuration to the ACP agent via `session/new` (`protocol/v1/session-setup`),
and ACP can forward the editor's own MCP tools through a stdio proxy
(`get-started/architecture`).

### IBM/BeeAI "Agent Communication Protocol" (the other ACP)

**[observed]** `https://www.ibm.com/think/topics/agent-communication-protocol`:
"**Agent Communication Protocol (ACP)** is an open standard for agent-to-agent
communication." It is "originally introduced by IBM's BeeAI". Key features
listed: "**REST-based communication:** ACP uses standard HTTP conventions ...";
"No SDK required"; "Offline discovery"; "Async-first, sync supported".

**[observed]** It is deprecated in favor of A2A. The same IBM page carries a note:
"*ACP has merged with A2A under the Linux Foundation umbrella. The ACP team is
winding down active development and contributing its technology and expertise to
A2A*." The GitHub repository `https://github.com/i-am-bee/acp` is marked "Public
archive" and "This repository was archived by the owner on Aug 27, 2025", with
the banner "**ACP is now part of A2A under the Linux Foundation!**".

**[observed]** A2A (`https://a2a-protocol.org/latest/`) is "An open protocol
enabling communication and interoperability between opaque agentic
applications", originally by Google, "donated to the Linux Foundation",
maintained by a TSC with "representatives from AWS, Cisco, Google, IBM Research,
Microsoft, Salesforce, SAP, and ServiceNow". It distinguishes itself: "MCP is for
agent-to-tool communication ... A2A is for agent-to-agent communication."

**[inferred]** IBM's ACP targets *agents talking to other agents* across
frameworks/organizations, not a host app driving a single coding agent. It is
not the ACP used for editor→coding-agent integration, and it is no longer under
active development.

### Agentic Commerce Protocol (ACP)

**[observed]** Search results (`koddi.com`, `lucidworks.com`,
`agilebrandguide.com`, `pixelart-agency.com`) describe a third "ACP", the
**Agentic Commerce Protocol**, an open protocol "for programmatic commerce flows
between buyers, AI agents, and businesses." **[inferred]** Unrelated to coding
agents or chat backends; noted only to disambiguate.

### OpenAI-compatible HTTP (Chat Completions)

**[observed]** The OpenAI Chat Completions API (`POST /chat/completions`,
`https://platform.openai.com/docs/api-reference/chat/create`) "Creates a model
response for the given chat conversation" and "Returns a chat completion object,
or a streamed sequence of chat completion chunk objects if the request is
streamed." With `stream: true`, "the model response data will be streamed to the
client as it is generated using server-sent events." This is the model-facing,
single-turn request/response shape — no sessions, no permission requests, no
filesystem/terminal capabilities, and no agent process management.

**[inferred]** An "OpenAI-compatible" endpoint is what a chat backend exposes to
talk to a *model*; ACP is what a host uses to talk to a *coding agent* (which may
itself call any model, including via an OpenAI-compatible endpoint). They operate
at different layers and are complementary, not competing.

### Summary table

| Name | Scope | Wire | Status |
| - | - | - | - |
| Agent Client Protocol (Zed/JetBrains) | editor/host ↔ coding agent | JSON-RPC 2.0; stdio (stable), HTTP/WS (draft) | stable v1; v2 draft |
| Agent Communication Protocol (IBM/BeeAI) | agent ↔ agent | REST/HTTP | merged into A2A; repo archived 2025-08-27 |
| Agentic Commerce Protocol | buyer/agent ↔ business | (commerce flows) | active; unrelated |
| MCP | agent ↔ tools/data | JSON-RPC | active; complementary |
| A2A | agent ↔ agent | HTTP/JSON, SSE, gRPC | active (Linux Foundation) |
| OpenAI-compatible HTTP | app ↔ model | HTTP + SSE | de facto standard; complementary |

---

## Observed vs inferred vs not established

**Observed (read directly):** the ACP site's introduction, architecture,
overview, transports, initialization, session-setup, prompt-turn, tool-calls,
file-system, terminals, session-modes, session-config-options, authentication,
agents, clients, Python library, v2 overview, v2 draft announcement, SDK 1.0
announcement, and the streamable-HTTP/WebSocket RFD; the GitHub repo README
(version, license, SDKs); Zed's external-agents page; IBM's ACP page; the
i-am-bee/acp repo (archived, merged into A2A); the A2A site; the OpenAI Chat
Completions API reference.

**Inferred:** that Agent Client Protocol is the "ACP" meant for external coding
agents; that a server-side web backend can act as an ACP client over stdio while
a browser-only client cannot; the layer distinction between ACP, MCP, and
OpenAI-compatible HTTP.

**Not established / conflicting:**
- The exact release date of ACP v1. Secondary sources say August 2025; a
  primary source with that date was not found in this pass.
- The precise stability status of the remote HTTP/WS transport as of this date:
  the transports page calls it a draft, the RFD is "Active" (2026-07-02) and
  "targeted for inclusion in v1", but no stable-release confirmation was found.
- Whether any specific real-world agent ships *remote* ACP as opposed to local
  stdio.

## What would settle the open items

- The `agentclientprotocol.com/updates` and GitHub releases pages for a v1.0.0
  release date and a transport-stabilization announcement.
- The ACP Registry entries and individual agent repos for whether any run over
  the remote transport rather than stdio.
