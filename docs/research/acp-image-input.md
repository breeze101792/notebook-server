# ACP image input — established facts

Researched 2026-11-17. Project context: `notebook-server` pins
`agent-client-protocol==0.12.1` (`requirements.txt`), imported as `acp`
(`acp_client.py:33`). That SDK vendors spec tag `schema-v1.19.0`
(`python-sdk@0.12.1:schema/VERSION`), protocol version integer `1`
(`acp/meta.py:49`, `PROTOCOL_VERSION = 1`). Agent Client Protocol v2 exists only
as a draft (`agentclientprotocol.com/announcements/acp-v2-draft`), so all
findings below are about v1.

## 1. Image content block in `session/prompt` — OBSERVED

The spec defines an image content block:

```json
{ "type": "image", "mimeType": "image/png", "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..." }
```

Fields, from `docs/protocol/v1/content.mdx:42-70` at tag `schema-v1.19.0`:

| field | type | required | note |
| - | - | - | - |
| `type` | `"image"` | yes | discriminator |
| `data` | `string` | yes | "Base64-encoded image data" |
| `mimeType` | `string` | yes | e.g. `image/png`, `image/jpeg` |
| `uri` | `string` | no | "Optional URI reference for the image source" |
| `annotations` | `Annotations` | no | MCP-compatible annotations |
| `_meta` | `object` | no | extension metadata |

Live page: https://agentclientprotocol.com/protocol/v1/content#image-content

Rust schema, same tag: `agent-client-protocol-schema/src/v1/content.rs:41`
(`Image(ImageContent)` variant of `ContentBlock`) and `:127-141`
(`struct ImageContent { data: String, mime_type: String, uri: Option<String>, ... }`),
with `#[serde(rename_all = "camelCase")]` at `:124`, so the wire name is
`mimeType`.

`uri` is an ACP addition over MCP: "ACP adds an optional `uri` on image content"
(`content.mdx:18`).

### Size limits and base64 — NOT ESTABLISHED (no limit specified)

- No maximum size, byte cap, or dimension limit for image content appears
  anywhere in the v1 docs. `schema.mdx:3774-3782` lists `ImageContent.data` as a
  plain `string` with no `maxLength`. A grep of all v1 protocol pages for
  size/limit language returns only unrelated hits (`maxTokens`, `fs/read_text_file`
  line limits, elicitation `maxItems`).
- Base64 is required for `data` (`content.mdx:58-60`), but the spec does not say
  whether padding/newlines are allowed. Not specified either way.
- The only transport constraint is framing: stdio messages are newline-delimited
  and **MUST NOT** contain embedded newlines
  (`docs/protocol/v1/transports.mdx:21`). Base64 without line wrapping satisfies
  this; the spec does not state it as a rule for image data.

## 2. Advertising image support — OBSERVED

Field path: `initialize` response →
`result.agentCapabilities.promptCapabilities.image` (boolean, default `false`).

- `docs/protocol/v1/initialization.mdx:243-245`:
  `<ResponseField name="image" type="boolean" post={["default: false"]}>` — "The
  prompt may include `image` content blocks".
- `initialization.mdx` also states the baseline: "As a baseline, all Agents
  **MUST** support `text` and `resource_link` content blocks in `session/prompt`
  requests. Optionally, they **MAY** support richer types ... by specifying the
  following capabilities".
- Rust: `src/v1/agent.rs:3958` `pub prompt_capabilities: PromptCapabilities` and
  `:4591-4596` `pub image: bool` with `#[serde(default)]` and
  `#[serde(rename_all = "camelCase")]` at `:4590`.
- Python SDK 0.12.1: `acp/schema.py:657` `image: Optional[bool] = False`;
  `acp/schema.py:5511-5513` `prompt_capabilities` aliased to
  `"promptCapabilities"`.

## 3. Python SDK 0.12.1 behaviour — OBSERVED

Verified against the installed package at
`.venv_nixlab/lib/python3.13/site-packages/acp` **and** the published source at
tag `0.12.1` of `agentclientprotocol/python-sdk` (identical).

- Helper exists: `def image_block(data: str, mime_type: str, *, uri: str | None = None) -> ImageContentBlock`
  — `src/acp/helpers.py:87-88` (local `acp/helpers.py:87-88`). Note `uri` is
  **keyword-only** (`*` in the signature).
- Exported at top level: `from .helpers import ... image_block` at
  `src/acp/__init__.py:14`, listed in `__all__` at `:203`. Confirmed at runtime:
  `'image_block' in dir(acp) == True`.
- Serialization uses the `mimeType` alias. `acp/utils.py:54-56`:
  `serialize_params(params)` → `params.model_dump(mode="json", by_alias=True, exclude_none=True, exclude_defaults=True)`,
  and `acp/schema.py:2748` defines `mime_type: Annotated[str, Field(alias="mimeType")]`.
  Direct check:

  ```
  acp.image_block(data='iVBORw0KGgo=', mime_type='image/png').model_dump(mode='json', by_alias=True, exclude_none=True)
  -> {'data': 'iVBORw0KGgo=', 'mimeType': 'image/png', 'type': 'image'}
  ```

- Consequence of `exclude_none=True`: an omitted `uri` is dropped from the wire,
  not sent as `null`.
- Consequence of `exclude_defaults=True`: capability defaults are dropped. A
  default `AgentCapabilities()` serializes to `{'auth': {}}`; `PromptCapabilities()`
  serializes to `{}`. So an agent that does not support images emits no `image`
  key at all, and a client must treat absent as `false`.
- `ImageContentBlock` is `class ImageContentBlock(ImageContent)` with
  `type: Literal["image"]` (`acp/schema.py:4095-4096`).

Version caveat: 0.12.1 has no `compaction` or `notice` symbols, which the live
v1 docs now describe, so the docs site is ahead of this SDK. The image block,
`image_block`, `PromptCapabilities.image`, and the capability path are unchanged
between `schema-v1.19.0` and current `main`.

## 4. Which agents accept images — OBSERVED

| agent | image advertised | evidence |
| - | - | - |
| `opencode acp` v2.2.1 | `true` | live `initialize` probe on this machine; source `packages/cli/src/acp/service.ts:138` |
| `claude-agent-acp` (Claude Code adapter) | `true` | `src/v1/acp-agent.ts:1841-1844` (main) |
| `codex-acp` | `true` | `src/CodexAcpServer.ts:850-853` (main) |
| Gemini CLI `--acp` | `true` | `packages/cli/src/acp/acpRpcDispatcher.ts:93-95` (main) |
| `block/goose` | `true` | `crates/goose/src/acp/server.rs:1793-1797` |

Details:

**opencode v2.2.1** — probed directly over stdio on this host, `initialize`
with `protocolVersion: 1` returned
`agentCapabilities.promptCapabilities = {"embeddedContext": true, "image": true}`.
Source matches: `promptCapabilities: { embeddedContext: true, image: true }` at
`packages/cli/src/acp/service.ts:138`. Prompt handling:
`packages/cli/src/acp/content.ts:28-33` builds `data:<mimeType>;base64,<data>`
when `data` is present, else falls back to `uri`;
`packages/cli/src/acp/prompt.ts:22-23` returns an invalid-request error only when
an image block has neither `data` nor `uri`.

**claude-agent-acp** — `src/v1/acp-agent.ts:1841-1844`:
`promptCapabilities: { image: true, embeddedContext: true }`. Image blocks are
converted in `src/prompt-to-claude.ts:86-98`. npm `@agentclientprotocol/claude-agent-acp`
latest `0.107.3`; repo `agentclientprotocol/claude-agent-acp` (the
`zed-industries/claude-agent-acp` URL 301-redirects there). The older
`@zed-industries/claude-code-acp` (latest 0.16.2) points at
`zed-industries/claude-code-acp` and was not inspected.

**codex-acp** — `src/CodexAcpServer.ts:850-853`:
`promptCapabilities: { embeddedContext: true, image: true }`. Image blocks map to
`{type: "image", url: <data-url or uri>}` in `src/CodexAcpClient.ts:1610-1613`,
`imageDataUrl()` at `:1637-1639`. npm `@agentclientprotocol/codex-acp` latest
`2.7.0`. Note a separate gate: when the selected model's
`inputModalities` lacks `image`, a steering prompt with an image is rejected with
`RequestError.invalidRequest("The current model does not support image input")`
(`src/CodexAcpServer.ts:3131-3132`).

**Gemini CLI** — `packages/cli/src/acp/acpRpcDispatcher.ts:93-95`:
`promptCapabilities: { image: true, audio: true, embeddedContext: true }`.
`#resolvePrompt(message: acp.ContentBlock[])` maps `image` to
`{ inlineData: { mimeType, data } }` (`packages/cli/src/acp/acpSession.ts:1007,1019-1025`).
`--acp` flag documented at `docs/cli/acp-mode.md:7-11`. Read on `main`
(`packages/cli` version `0.70.0-nightly.20261110.g1603e9bab`); not installed on
this host, so no live probe. Latest stable tag seen: `v0.68.0`.

**block/goose** — `crates/goose/src/acp/server.rs:1793-1797`:
`PromptCapabilities::new().image(true).audio(false).embedded_context(true)`.
Workspace version `1.60.0`. Not installed here, no live probe.

Local caveat: the checked-in binaries of `claude` (2.1.223) and `codex`
(codex-cli 0.146.0) have no `acp` subcommand (`claude --help`, `codex --help`),
so ACP mode for those two comes only from the adapter packages above.

## 5. Client sends an image when `image` is false — NOT ESTABLISHED

What the spec does say:

- The obligation is on the **client**: "Clients **MUST** restrict types of
  content according to the [Prompt Capabilities] established during
  initialization" (`docs/protocol/v1/prompt-turn.mdx:115`). Same page, prompt
  field: "The contents of the user message, e.g. text, images, files, etc."
- The spec defines **no** specific error code, no dedicated capability-violation
  error, and no stated agent behaviour for receiving an unadvertised content
  block type in `session/prompt`. A grep of all v1 protocol pages for
  restriction/enforcement language found no such rule.
- Closest generic codes, from `docs/protocol/v1/error.mdx`: `-32602` (Invalid
  params) is defined as "The parameters are malformed or contain a value the
  receiver does not support" (`error.mdx:47`); `-32601` is for an unimplemented
  or capability-gated *method* (`error.mdx:43`).
- For a different method, the spec does bind this case: a `systemPrompt` that
  the Agent cannot apply "for example because of ... an unsupported content block
  type" **MUST** return an error, with `-32602` **RECOMMENDED**
  (`docs/protocol/v1/session-setup.mdx:401`). That is `session/new`,
  `session/load`, `session/resume` — not `session/prompt`.

INFERRED: `-32602` is the natural code for an image block sent to an
`image: false` agent, by analogy with the `systemPrompt` rule. The spec does not
state it, and behaviour is implementation-defined; a client cannot rely on an
error being returned at all. Only opencode's code path was inspected on this
point (`prompt.ts:22-23` rejects only missing `data`/`uri`, not unadvertised
type), and it advertises `image: true` anyway, so it does not settle the case.

## Implications for this project (observation, not design)

- `acp_client.py:265-266` currently sends `prompt=[text_block(prompt)]` — text
  only.
- `acp_client.py:224-231` reads only `init.protocol_version` from the
  `initialize` response; it never inspects
  `agentCapabilities.promptCapabilities`.
- The pinned SDK 0.12.1 already provides everything needed to build and send an
  image block and to read the capability; nothing needs upgrading for this.
