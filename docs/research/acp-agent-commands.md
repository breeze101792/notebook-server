# ACP agents — exact stdio launch commands

**Question.** For the common ACP (Agent Client Protocol) agents, establish the
exact executable and argv that start a *stdio* ACP server, whether an adapter
package must be installed first, and whether the transport is stdio — so the
notebook server can ship a hard-coded allowlist for auto-detection.

**Finding.** Every priority target has a documented stdio ACP entrypoint, and
none of the priority targets is network-only. Two of them are **not** native:
Anthropic Claude and OpenAI Codex are reached through separate npm adapter
packages, not through the `claude`/`codex` binaries. Everything else (Gemini,
Goose, Cursor, opencode, Copilot, Kiro, Qwen, Kimi, Cline, OpenHands, Auggie,
Docker Agent) is native to the agent's own CLI.

One documented conflict is unresolved: Gemini CLI's flag is `--acp` in its
dedicated ACP doc, but `--experimental-acp` in the same repo's CLI cheatsheet.
See [Open / conflicting](#open--conflicting).

---

## Allowlist table

`needs-adapter = yes` means the ACP server is a separate package that must be
installed; the agent CLI it wraps is still required for auth.

| key | label | executable | args | needs-adapter | transport | source |
|---|---|---|---|---|---|---|
| `claude-code` | Claude Agent (Anthropic) | `claude-agent-acp` (current) · `claude-code-acp` (deprecated) | *(none)* | **yes** — `@agentclientprotocol/claude-agent-acp`; `npm i -g @agentclientprotocol/claude-agent-acp` | stdio | agents page; adapter README/package.json |
| `codex` | OpenAI Codex CLI | `codex-acp` | *(none)* | **yes** — `@agentclientprotocol/codex-acp`; `npm i -g @agentclientprotocol/codex-acp` (or `npx -y @agentclientprotocol/codex-acp`) | stdio | adapter README/package.json |
| `gemini` | Gemini CLI | `gemini` | `--acp` (older: `--experimental-acp`) | no — native; `npm i -g @google/gemini-cli` | stdio | geminicli.com acp-mode; repo docs |
| `goose` | Goose (AAIF/Block) | `goose` | `acp` | no — native | stdio | goose-docs.ai GDK ACP |
| `cursor` | Cursor CLI | `agent` | `acp` | no — native; `curl https://cursor.com/install -fsS \| bash` | stdio | cursor.com/docs/cli/acp + installation |
| `opencode` | opencode | `opencode` | `acp` | no — native | stdio | opencode.ai/docs/acp |
| `copilot` | GitHub Copilot CLI | `copilot` | `--acp` (stdio by default) or `--acp --stdio` | no — native (public preview) | stdio | docs.github.com Copilot CLI ACP server |
| `kiro` | Kiro CLI (AWS) | `kiro-cli` | `acp` (optional `--agent <name>`) | no — native | stdio | kiro.dev/docs/cli/acp |
| `qwen` | Qwen Code | `qwen` | `--acp` | no — native; `npm i -g @qwen-code/qwen-code` | stdio | repo package.json; Qwen Zed doc |
| `kimi` | Kimi Code CLI | `kimi` | `acp` | no — native | stdio | kimi-code README + package.json |
| `cline` | Cline CLI | `cline` | `--acp` | no — native; `npm i -g cline` | stdio | docs.cline.bot/usage/acp |
| `openhands` | OpenHands CLI | `openhands` | `acp` | no — native; `pip install openhands` / `uv tool install openhands` | stdio | docs.openhands.dev ACP |
| `auggie` | Augment Code CLI | `auggie` | `--acp` | no — native | stdio | docs.augmentcode.com/cli/acp |
| `docker-agent` | Docker Agent (cagent) | `docker` | `agent serve acp <config>` | no — native; needs an agent config file arg | stdio | docs.docker.com Docker Agent ACP |

Notes that matter for a binary-name allowlist:

- **`claude-code` is an adapter, not `claude`.** The installed `claude` binary
  is the Claude Code CLI; it has no documented ACP mode. The ACP server is the
  npm adapter `claude-agent-acp`. Do not map the `claude` binary to ACP.
- **`codex` is an adapter, not `codex`.** The adapter is `codex-acp` and it
  bundles a compatible `@openai/codex` dependency; `CODEX_PATH` can point it at
  a different binary.
- **`docker-agent` is not a bare command.** It requires a config file
  (`docker agent serve acp ./agent.yaml`), so it cannot be auto-launched with
  empty args.
- **`agent` is ambiguous as a binary name.** Cursor documents `agent`; it is a
  generic name that could collide.

---

## Evidence per entry

Each item states what was read. URLs were opened in this session.

### 1. Claude Code / Claude Agent — adapter required

- **ACP agents page** lists: "Claude Agent (via [Zed's SDK adapter](https://github.com/zed-industries/claude-agent-acp))".
  Source: <https://agentclientprotocol.com/get-started/agents>
- **Adapter README** (fetched raw) — title "ACP adapter for the Claude Agent
  SDK", badge links `@agentclientprotocol/claude-agent-acp`.
  Source: <https://raw.githubusercontent.com/zed-industries/claude-agent-acp/main/README.md>
- **Adapter `package.json`** (fetched raw) — `"name": "@agentclientprotocol/claude-agent-acp"`,
  `"bin": { "claude-agent-acp": "dist/index.js" }`, `"engines": { "node": ">=22" }`.
  Source: <https://raw.githubusercontent.com/zed-industries/claude-agent-acp/main/package.json>
- **Superseded package** `@zed-industries/claude-code-acp` (npm registry, fetched):
  `"bin": { "claude-code-acp": "dist/index.js" }` and
  `"deprecated": "This package has been renamed to @agentclientprotocol/claude-agent-acp. Please migrate to continue receiving updates."`
  Source: <https://registry.npmjs.org/@zed-industries%2fclaude-code-acp/latest>
- **Goose provider docs** confirm the same install command:
  `npm install -g @agentclientprotocol/claude-agent-acp`.
  Source: <https://goose-docs.ai/docs/guides/acp-providers/>

Observed: the ACP server is the adapter binary `claude-agent-acp`; the
`@zed-industries/claude-code-acp` package (binary `claude-code-acp`) is
deprecated in its favour. Both binary names exist in the wild.
Inferred: no `claude acp` exists. Not established: a native ACP flag on
Anthropic's `claude` CLI — no primary source documenting one was found.

### 2. OpenAI Codex CLI — adapter required

- **ACP agents page**: "Codex CLI (via [ACP's adapter](https://github.com/agentclientprotocol/codex-acp))".
  Source: <https://agentclientprotocol.com/get-started/agents>
- **Adapter README**: "`codex-acp` is a stdio ACP agent server. It starts the
  Codex App Server…". Install: `npx -y @agentclientprotocol/codex-acp` or
  `npm install -g @agentclientprotocol/codex-acp` then `codex-acp --version`.
  Source: <https://raw.githubusercontent.com/agentclientprotocol/codex-acp/main/README.md>
- **Adapter `package.json`**: `"name": "@agentclientprotocol/codex-acp"`,
  `"bin": { "codex-acp": "dist/index.js" }`, dependency `@openai/codex`.
  Source: <https://raw.githubusercontent.com/agentclientprotocol/codex-acp/main/package.json>
- **Superseded package** `@zed-industries/codex-acp` (npm registry):
  `"bin": { "codex-acp": "bin/codex-acp.js" }`, deprecated:
  "This package has been replaced by @agentclientprotocol/codex-acp."
  Source: <https://registry.npmjs.org/@zed-industries%2fcodex-acp/latest>
- **Goose docs** show `codex-acp --version` outputs
  `@agentclientprotocol/codex-acp`.
  Source: <https://goose-docs.ai/docs/guides/acp-providers/>

Observed: executable `codex-acp`, no args, stdio. The binary name `codex-acp`
is identical in the old and new packages, so a binary-name allowlist keeps
working across the scope rename.

### 3. Gemini CLI — confirm the flag

- **Gemini CLI ACP doc** (official docs site): "It uses a JSON-RPC protocol
  over stdio… To start Gemini CLI in ACP mode, use the `--acp` flag:
  `gemini --acp`."
  Source: <https://geminicli.com/docs/cli/acp-mode/>
- **Same doc in the repo** (fetched raw): identical text, `gemini --acp`.
  Source: <https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/acp-mode.md>
- **Repo CLI cheatsheet** (fetched raw) still lists
  `--experimental-acp` — "Start in ACP (Agent Code Pilot) mode. **Experimental
  feature.**" — and does not list `--acp`.
  Source: <https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/cli-reference.md>

Observed: two sources say `--acp`; one source in the same repo says
`--experimental-acp`. Not established: which flag the installed version
accepts. See [Open / conflicting](#open--conflicting).
Caveat: the docs banner states Gemini CLI was replaced by Antigravity CLI for
unpaid/Google One users on 18 June 2026.

### 4. Goose — `goose acp`

- **Goose GDK ACP doc**: "Configure your ACP client to launch goose as a
  subprocess with this command: `goose acp` … The client communicates with
  goose through stdin and stdout." Also documents `goose serve` for
  HTTP/WebSocket (`/acp` endpoint on `127.0.0.1:3284`) — a separate,
  non-stdio entrypoint to exclude.
  Source: <https://goose-docs.ai/docs/gdk/acp/>
- Zed's ACP agent page: "Square's open-source agent with native ACP
  implementation."
  Source: <https://zed.dev/acp/agent/goose>

Observed: native, stdio, `goose acp`. Note the canonical agents page still
links `block/goose`; the project moved to the Agentic AI Foundation
(`aaif-goose/goose`) per the docs banner.

### 5. Cursor — `agent acp`

- **Cursor ACP doc**: "You can run `agent acp` and connect a custom client
  over `stdio` using JSON-RPC." Transport table: stdio, JSON-RPC 2.0,
  newline-delimited JSON. Uses `"agent acp"` throughout, including the sample
  Node client `spawn("agent", ["acp"], …)`.
  Source: <https://cursor.com/docs/cli/acp>
- **Cursor installation doc**: `curl https://cursor.com/install -fsS | bash`;
  verify with `agent --version`.
  Source: <https://cursor.com/docs/cli/installation>

Observed: the documented executable is `agent`, args `acp`, stdio.
Inferred: `cursor-agent` is an older/alternate name for the same tool —
third-party sources report it, but the Cursor pages read here document only
`agent`. Treat `cursor-agent` as a possible alias, not a confirmed one.

### 6. opencode — `opencode acp` (verified on this host)

- **opencode ACP doc**: "configure your editor to run the `opencode acp`
  command … communicates with your editor over JSON-RPC via stdio."
  Source: <https://opencode.ai/docs/acp/>
- Locally verified previously: opencode 1.15.10 answers `initialize` with
  `protocolVersion` 1. The server's own client is
  `acp_client.py:196` (`spawn_agent_process`), and the config format is
  `{name, command, args, cwd, env, default}` per `CLAUDE.md`.

Observed: native, stdio, `opencode acp`.

### 7. GitHub Copilot CLI — native, `copilot --acp`

- **GitHub Copilot CLI ACP server doc**: "Use the `--acp` option of the
  `copilot` command to start the CLI's ACP server… If no transport mode is
  specified, the server defaults to stdio mode." stdio example:
  `copilot --acp --stdio`. TCP mode is opt-in via `--port`. Public preview.
  Source: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server>

Observed: native, stdio by default, executable `copilot`. Not established:
the install package name (not stated on the page read).

### 8. Kiro CLI — native, `kiro-cli acp`

- **Kiro ACP doc**: "Run Kiro as an ACP agent: `kiro-cli acp`… The agent
  communicates over stdin/stdout using JSON-RPC 2.0." Optional
  `kiro-cli acp --agent my-agent`.
  Source: <https://kiro.dev/docs/cli/acp/>

Observed: native, stdio. The page documents the legacy CLI v2 ACP server and
links a CLI V3 migration guide; the launch form `kiro-cli acp` is what is
documented on the page read. (A third-party crate page lists
`kiro-cli-chat acp`; unverified against a Kiro source.)

### 9. Qwen Code — native, `qwen --acp`

- **Repo `package.json`**: `"name": "@qwen-code/qwen-code"`,
  `"bin": { "qwen": "dist/index.js" }`, depends on `@agentclientprotocol/sdk`.
  Source: <https://raw.githubusercontent.com/QwenLM/qwen-code/main/packages/cli/package.json>
- **Qwen Code Zed doc**: custom agent config `"command": "qwen", "args": ["--acp"]`;
  install `npm install -g @qwen-code/qwen-code`.
  Source: <https://qwenlm.github.io/qwen-code-docs/en/users/integration-zed/>

Observed: native, stdio, `qwen --acp`. A separate daemon (`qwen serve`,
HTTP/REST) and a `@qwen-code/acp-bridge` internal library also exist; the
editor path is `qwen --acp`.

### 10. Kimi Code CLI — native, `kimi acp`

- **Repo README** (fetched raw): "…any ACP client with `kimi acp`… point your
  editor at the `kimi acp` subcommand"; Zed config `"command": "kimi",
  "args": ["acp"]`. Install via `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash`.
  Source: <https://raw.githubusercontent.com/MoonshotAI/kimi-code/main/README.md>
- **Repo `package.json`**: `"name": "@moonshot-ai/kimi-code"`,
  `"bin": { "kimi": "dist/main.mjs" }`.
  Source: <https://raw.githubusercontent.com/MoonshotAI/kimi-code/main/apps/kimi-code/package.json>

Observed: native, stdio, `kimi acp`. The older Python `MoonshotAI/kimi-cli`
repo is archived; use `kimi-code`.

### 11. Cline — native, `cline --acp`

- **Cline ACP doc**: "ACP mode is started with the `--acp` flag: `cline --acp`.
  You don't run this yourself — the client launches the command and talks to
  Cline over stdio." Install `npm i -g cline`.
  Source: <https://docs.cline.bot/usage/acp>

Observed: native, stdio.

### 12. OpenHands — native, `openhands acp`

- **OpenHands IDE/ACP doc**: "Your IDE launches `openhands acp` as a
  subprocess… Communication happens via JSON-RPC 2.0 over stdio." Options
  include `--resume`, `--always-approve`, `--llm-approve`.
  Source: <https://docs.openhands.dev/openhands/usage/run-openhands/acp>

Observed: native, stdio. Install is via the OpenHands CLI (pip/uv or install
script); the ACP entrypoint documented is `openhands acp`.

### 13. Augment Code CLI (Auggie) — native, `auggie --acp`

- **Augment ACP doc**: "you need to pass the `--acp` flag when starting
  Auggie… `auggie --acp`"; "ACP mode uses JSON-RPC over standard input and
  output."
  Source: <https://docs.augmentcode.com/cli/acp>

Observed: native, stdio, executable `auggie`. Inferred (from a subagent's
read of the npm registry, not re-opened here): package
`@augmentcode/auggie`, `bin: auggie`.

### 14. Docker Agent (cagent) — native, `docker agent serve acp <config>`

- **Docker ACP doc**: "The `docker agent serve acp` command starts an ACP
  server that communicates over **stdio**." Usage:
  `docker agent serve acp ./agent.yaml`. Binary is a `docker` CLI plugin
  (`docker-agent` run directly or symlinked into `~/.docker/cli-plugins/`).
  Source: <https://docs.docker.com/ai/docker-agent/features/acp/>

Observed: native, stdio, but requires a config-file argument. Inferred (not
quoted by Docker): the standalone binary form is
`docker-agent serve acp <config>`.

---

## Canonical list of ACP agents

Source for all of the following: <https://agentclientprotocol.com/get-started/agents>
(read in full this session). The page states each entry is an agent that "can
be used with an ACP Client". Where the page names an adapter, a one-line note
is given.

| Agent | Ships its own ACP server, or adapter? |
|---|---|
| AgentPool | own (links its own ACP-integration docs) |
| Augment Code | own |
| AutoDev | own |
| Blackbox AI | own |
| Bub | **adapter** — via `bub-acp-server` |
| Claude Agent | **adapter** — via Zed's SDK adapter (`claude-agent-acp`) |
| Claw Orchestrator | own |
| Cline | own |
| Codex CLI | **adapter** — via ACP's adapter (`codex-acp`) |
| Code Assistant | own |
| Construct | own |
| crow-cli | own |
| CUGA | own (`cuga-acp`) |
| Cursor | own |
| Docker's cagent | own |
| fast-agent | own |
| Factory Droid | own |
| fount | own |
| Gemini CLI | own |
| GitHub Copilot | own (public preview) |
| Goose | own |
| Hermes Agent | own |
| Junie by JetBrains | own |
| Kaagum | own |
| Kimi CLI | own |
| Kiro CLI | own |
| localharness | own |
| Minion Code | own |
| Mistral Vibe | own |
| Muse Spark Code | own |
| OpenClaw | own |
| OpenCode | own |
| OpenHands | own |
| Pi | **adapter** — via `pi-acp` |
| Poolside | own (`pool acp`) |
| Qoder CLI | own |
| Qwen Code | own |
| Raven | own (`raven acp`) |
| Raxol | own (`raxol acp`) |
| siGit Code | own |
| Stakpak | own |
| stdio Bus | own |
| VT Code | own |

Additionally, the **ACP Registry** is the curated distribution list
(<https://agentclientprotocol.com/get-started/registry>). Zed installs agents
from that registry (<https://zed.dev/docs/ai/external-agents>). "Own" means the
agents page does not name an adapter for that entry; it is not a guarantee that
every one ships a bare-binary stdio entrypoint.

---

## Non-stdio (network) agents — must be excluded from a stdio table

Source: <https://agentclientprotocol.com/get-started/introduction> — "Local
agents run as sub-processes of the code editor, communicating via JSON-RPC
over stdio. Remote agents can be hosted in the cloud or on separate
infrastructure, communicating over HTTP or WebSocket."

Among the targets in this report, **none is network-only**; every one has a
documented stdio entrypoint as tabulated. Two products expose *both* a stdio
and a network server, so the allowlist must pick the stdio subcommand:

- **Goose**: stdio is `goose acp`; the network server is `goose serve`
  (HTTP/WebSocket on `127.0.0.1:3284`, endpoint `/acp`). Exclude `goose serve`.
  Source: <https://goose-docs.ai/docs/gdk/acp/>
- **GitHub Copilot CLI**: stdio is the default `copilot --acp`; TCP mode is
  opt-in with `--acp --port 3000`. Exclude the `--port` form.
  Source: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server>

Generally, cloud-hosted agents (e.g. Devin) connect remotely over
HTTP/WebSocket and are out of scope for a local stdio allowlist. That is an
inference from the protocol's own local/remote split, not a per-agent source
review.

---

## npm scopes and binary-name stability

Observed from the npm registry and package.json files read above:

- The adapters moved from the `@zed-industries/*` scope to the
  `@agentclientprotocol/*` scope. Both source packages are now marked
  deprecated with a "migrate" message.
- **Codex**: binary name `codex-acp` is **unchanged** across the rename — the
  old `@zed-industries/codex-acp` and new `@agentclientprotocol/codex-acp` both
  expose `codex-acp`.
- **Claude**: the binary name **changed** with the rename — old
  `claude-code-acp`, new `claude-agent-acp`.
- The adapters can also be launched without a global binary via `npx`, e.g.
  `npx -y @agentclientprotocol/codex-acp`. **A PATH-binary allowlist will not
  see an npx-only install.** If auto-detection is binary-name based, include
  both legacy and current Claude names, and treat npx-only installs as a
  separate detection case (or always use `command`+`args` from config).

So: stable binary names for Codex (unchanged); Claude's is stable going
forward but has a rename in its history; the npm scope is stable going forward
(`@agentclientprotocol`) but is not the identifier a binary-name detector uses.

---

## Host PATH check (this host, read-only)

Command: `command -v <name>` for each candidate; no agent was executed, nothing
was installed. Host: `Linux`, `nixlab`.

Installed:

| binary | absolute path | note |
|---|---|---|
| `opencode` | `/etc/profiles/per-user/shaowu/bin/opencode` | the ACP entrypoint (`opencode acp`) — present |
| `claude` | `/etc/profiles/per-user/shaowu/bin/claude` | Claude Code CLI — **not** an ACP server |
| `codex` | `/etc/profiles/per-user/shaowu/bin/codex` | Codex CLI — **not** an ACP server |

Not found on PATH: `claude-agent-acp`, `claude-code-acp`, `codex-acp`,
`gemini`, `goose`, `agent`, `cursor-agent`, `cursor`, `kiro-cli`,
`kiro-cli-chat`, `kiro`, `qwen`, `qwen-code`, `kimi`, `cline`, `openhands`,
`auggie`, `augment`, `docker`, `cagent`, `junie`, `pool`, `openclaw`.

Interpretation: this host can launch **opencode ACP** out of the box. It can
launch **neither** Claude nor Codex over ACP without first installing the
adapter packages, even though the underlying `claude` and `codex` CLIs are
present.

---

## Observed vs inferred vs not established

- **Observed** (read directly at the cited URL / local file): every executable
  name, arg vector, package name, and transport in the table; the npm
  deprecation messages; the canonical agents list; the host `command -v`
  results.
- **Inferred**: the standalone `docker-agent serve acp <config>` form; that
  `cursor-agent` is an alias of Cursor's `agent`; that no native `claude acp`
  exists (absence of evidence, not a negative source).
- **Not established**:
  - Which Gemini flag the installed version accepts (`--acp` vs
    `--experimental-acp`).
  - Any version boundary for both flags.
  - The exact install package for Copilot CLI (not stated on the page read).
  - The `@augmentcode/auggie` package metadata (taken from a subagent, not
    re-opened here).

---

## Open / conflicting

1. **Gemini flag conflict.** `docs/cli/acp-mode.md` (and the docs site) say
   `gemini --acp`; `docs/cli/cli-reference.md` in the same repo still lists
   `--experimental-acp`. Both are on `main` as read. What would settle it:
   `gemini --help` output from the exact installed version, or a changelog
   entry naming the rename.
2. **Cursor binary name.** Cursor's own docs use `agent`; multiple third-party
   sources use `cursor-agent`. What would settle it: the Cursor CLI install
   script's target name, or `agent --version` / `cursor-agent --version` on a
   machine with it installed.
3. **Kiro CLI V3.** The page read documents the legacy CLI v2 ACP server;
   V3 may change method names (not the launch form). What would settle it: the
   linked "Migrate an ACP client to CLI V3" page.
4. **`npx`-only installs.** A binary-name detector misses adapter packages run
   via `npx` without a global install.

## Recommendation

- Ship the allowlist keyed on the **binary name** in the table, with args as
  listed. Detection by `command -v` is safe for the native entrypoints.
- For the two adapters, detect the **adapter** binaries
  (`codex-acp`; and both `claude-agent-acp` and the legacy `claude-code-acp`),
  **not** `claude`/`codex`. A present `claude`/`codex` binary means "CLI
  installed", not "ACP available".
- Accept both Gemini flags at launch time until the conflict is resolved, or
  gate on the installed version.
- Exclude the network variants from the stdio allowlist: `goose serve` and
  `copilot --acp --port …`.
- `docker-agent` needs a config-file argument, so it does not fit an
  empty-args allowlist entry as-is.

This report establishes the launch commands from primary sources; the choice
of which agents to ship and how to detect them belongs to `plan` / `architect`.
