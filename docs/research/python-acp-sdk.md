# The official Python SDK for the Agent Client Protocol (ACP)

Researched 2026-10-13. External sources read directly; URLs are cited inline.
Claims are tagged **[observed]** (read in a source), **[inferred]** (conclusion
drawn from sources), or **[assumption]**. Where the sources do not settle a
question it is marked **[not established]**.

Two evidence types are used: published sources (PyPI, GitHub, the SDK docs) and
the installed artifact itself. The artifact is a primary source: it is the code
that would run. Where noted, I installed the released package into a throwaway
virtualenv and inspected it directly.

---

## Question

Establish, with citations to primary sources, the facts about the official
Python SDK for the Agent Client Protocol (ACP). The motivating decision:
whether a synchronous Flask app can use it as an ACP *client* that launches a
local agent subprocess (`opencode acp`) over stdio and relays `session/update`
streaming to a browser. No integration is designed here.

---

## Finding (short)

- The official Python SDK is **async-only**; every client/agent method is
  `async def`. There is **no synchronous facade**. Embedding it in a synchronous
  threaded app is **not documented** by the SDK.
- It **can** spawn the agent subprocess for you (`spawn_agent_process`) or wire
  your own pipes (`connect_to_agent`), both over **asyncio streams**.
- `session/update` is delivered as an **async callback method** on your `Client`
  subclass, not an async iterator.
- Stable `0.12.1` speaks **ACP v1 only** (schema v1.23.0). The **v2 draft** schema
  exists only in the `1.0.0rc` prereleases (`acp.experimental.v2`).
- The SDK is Apache-2.0, under the `agentclientprotocol` GitHub org, Python
  3.10–3.14, runtime dependency effectively `pydantic`.

---

## 1. Package identity

**[observed]** Distribution name on PyPI is **`agent-client-protocol`**
(`info.name` in the PyPI JSON API, `https://pypi.org/pypi/agent-client-protocol/json`;
also `pyproject.toml` `name = "agent-client-protocol"`). Project page:
`https://pypi.org/project/agent-client-protocol/`.

**[observed]** Import name is **`acp`**. `pyproject.toml` builds from `src/acp/`,
and every example does `from acp import ...` (e.g.
`https://raw.githubusercontent.com/agentclientprotocol/python-sdk/main/examples/client.py`).
The installed module reports `acp.__file__ = .../site-packages/acp/__init__.py`.

**[observed]** Latest **stable** version is **0.12.1**, uploaded
**2026-08-16T14:08:21Z** (PyPI JSON `info.version` and `urls[].upload_time`).
Latest **pre-release** is **1.0.0rc3**, uploaded **2026-10-12T09:38:45Z** (PyPI
JSON `releases["1.0.0rc3"]`; GitHub release `1.0.0rc3`, `prerelease: true`,
published `2026-10-12T09:38:14Z`, `https://api.github.com/repos/agentclientprotocol/python-sdk/releases`).
`pip install agent-client-protocol` without `--pre` therefore resolves **0.12.1**.

**[observed]** GitHub repository is **`https://github.com/agentclientprotocol/python-sdk`**.
The owner is the **`agentclientprotocol` organization** (GitHub API
`owner.type: "Organization"`, `owner.login: "agentclientprotocol"`) — the same
org that hosts the ACP specification repository. So it is the *official* SDK,
not a third-party one.

**[observed]** License is **Apache-2.0**: the repo `LICENSE` file contains the
Apache License, Version 2.0 text
(`https://raw.githubusercontent.com/agentclientprotocol/python-sdk/main/LICENSE`),
and the GitHub API license object is
`{"key":"apache-2.0","spdx_id":"Apache-2.0"}`.

**[observed, conflict]** The PyPI JSON for 0.12.1 carries `"license": null`,
`"license_expression": null`, `"license_files": null` — the license is **not
declared in the PyPI metadata**. The repository `LICENSE` and GitHub's detected
license are authoritative and say Apache-2.0.

**[observed]** Maintainer / publisher: the maintainer is listed in the docs
footer and package metadata as **`psiace`** = **Chojan Shang
(`psiace@apache.org`)**, co-author **Frost Ming (`me@frostming.com`)**
(`pyproject.toml` `authors`; PyPI JSON `info.author_email`;
`https://agentclientprotocol.github.io/python-sdk/` footer "Maintained by psiace").
The **PyPI owner account is the individual `PsiACE`**, not an org
(PyPI JSON `ownership.roles[0].user = "PsiACE"`). **[inferred]** The code is
org-owned; the PyPI publishing account belongs to a maintainer.

---

## 2. Sync or async? Is there a synchronous facade?

**[observed] Async-native; no synchronous facade.** Two independent doc
statements:

- SDK docs hub: "`acp.agent` / `acp.client`: **async base classes**, JSON-RPC
  supervision, and lifecycle orchestration."
  (`https://agentclientprotocol.github.io/python-sdk/`)
- README: "Build ACP-compliant agents and clients in Python with generated
  schema models, **asyncio transports**, and runnable demos." and "**Async base
  classes**, stdio JSON-RPC plumbing, and lifecycle helpers keep custom agents tiny."
  (`https://github.com/agentclientprotocol/python-sdk`)

**[observed]** All interface methods are `async def` (27 `async def` in
`src/acp/interfaces.py`; the only non-async `def` are `on_connect`). The two
entry points are async constructs:

- `spawn_agent_process(...)` returns an `AsyncIterator[...]` and is used with
  `async with` (`src/acp/stdio.py`).
- `connect_to_agent(...)` returns a `ClientSideConnection` whose methods
  (`initialize`, `new_session`, `prompt`, ...) are all `async def`
  (`src/acp/client/connection.py`).

**[observed]** The official programmatic example is wrapped in
`asyncio.run(main())`. Quoted from the Quickstart, "Programmatic launch"
(`https://agentclientprotocol.github.io/python-sdk/quickstart/`):

```python
import asyncio
import sys
from pathlib import Path
from typing import Any

from acp import PROTOCOL_VERSION, spawn_agent_process, text_block
from acp.interfaces import Client


class SimpleClient(Client):
    async def request_permission(
        self, session_id, tool_call, options, **kwargs: Any
    ):
        return {"outcome": {"outcome": "cancelled"}}

    async def session_update(self, session_id, update, **kwargs):
        print("update:", session_id, update)


async def main() -> None:
    script = Path("examples/echo_agent.py")
    async with spawn_agent_process(SimpleClient(), sys.executable, str(script)) as (conn, _proc):
        await conn.initialize(protocol_version=PROTOCOL_VERSION)
        session = await conn.new_session(cwd=str(script.parent), mcp_servers=[])
        await conn.prompt(
            session_id=session.session_id,
            prompt=[text_block("Hello from spawn!")],
        )

asyncio.run(main())
```

**[observed]** I searched the installed 0.12.1 package for a synchronous wrapper
(`run_sync`, a sync client class, `to_thread`, `run_coroutine_threadsafe`) and
found none; the only `sync`-matching hits were ordinary `asyncio` usage inside
`acp/http/client.py`. There is no `*SyncClient` / blocking facade.

**[not established]** How a synchronous, threaded app is *expected* to embed the
SDK. The SDK documents only async entry points and never addresses running from
a non-async thread. The common pattern — run one asyncio event loop on a
dedicated background thread and submit coroutines to it with
`asyncio.run_coroutine_threadsafe`, rather than calling `asyncio.run` per
request — is **[inferred]** standard practice, **not** a claim made by the SDK.
Calling `asyncio.run(...)` around a long-lived ACP connection per HTTP request
would be an application design choice the SDK gives no guidance on.

**[observed, relevant]** An SDK issue (#154, closed "not planned") documents that
`ClientSideConnection.prompt()` waits for in-flight `session_update` handlers
before returning, and that this wait is also on the error path — so a slow async
update handler delays the caller. This matters for any relaying design, but it
is a behaviour of the async API, not evidence of a sync path
(`https://github.com/agentclientprotocol/python-sdk/issues/154`).

---

## 3. Spawning the agent: does the SDK spawn the subprocess?

**[observed] Both are provided.** The SDK offers a helper that spawns the
subprocess for you, and a lower-level entry point where you supply the pipes.

### (a) SDK spawns the process — `spawn_agent_process`

Used in the Quickstart and in `examples/duet.py`. Signature, from
`src/acp/stdio.py`:

```python
@asynccontextmanager
async def spawn_agent_process(
    to_client: Callable[[Agent], Client] | Client,
    command: str,
    *args: str,
    env: Mapping[str, str] | None = None,
    cwd: str | Path | None = None,
    transport_kwargs: Mapping[str, Any] | None = None,
    **connection_kwargs: Any,
) -> AsyncIterator[tuple[ClientSideConnection, aio_subprocess.Process]]:
    """Spawn an ACP agent subprocess and return a ClientSideConnection to it."""
```

It delegates to `spawn_stdio_transport(command, *args, ...)` in
`src/acp/transports.py`, which calls `asyncio.create_subprocess_exec(command,
*args, stdin=PIPE, stdout=PIPE, stderr=PIPE, env=..., cwd=...)` and yields the
asyncio reader/writer streams plus the process. It also trims the inherited
environment to a safe allowlist (`HOME`, `PATH`, `SHELL`, `TERM`, `USER`, ... on
POSIX) before merging any `env` you pass. Official example, `examples/duet.py`:

```python
async with spawn_agent_process(client, sys.executable, str(agent_path), env=env) as (
    conn,
    process,
):
    await conn.initialize(protocol_version=PROTOCOL_VERSION, client_capabilities=None)
    session = await conn.new_session(mcp_servers=[], cwd=str(root))
    await client_module.interactive_loop(conn, session.session_id)
```

### (b) You provide the pipes — `connect_to_agent`

Used in `examples/client.py`. The caller creates the subprocess itself and hands
the SDK the asyncio streams:

```python
proc = await asyncio.create_subprocess_exec(
    spawn_program,
    *spawn_args,
    stdin=aio_subprocess.PIPE,
    stdout=aio_subprocess.PIPE,
)
...
client_impl = ExampleClient()
conn = connect_to_agent(client_impl, proc.stdin, proc.stdout)
```

`connect_to_agent` signature (`src/acp/core.py`):

```python
def connect_to_agent(
    client: Client,
    input_stream: Any,
    output_stream: Any = None,
    *,
    use_unstable_protocol: bool = False,
    **connection_kwargs: Any,
) -> ClientSideConnection:
```

**[observed]** The streams must be asyncio objects: `ClientSideConnection.__init__`
raises `TypeError("ClientSideConnection requires asyncio StreamWriter/StreamReader")`
unless it receives an `asyncio.StreamWriter` (input) and `asyncio.StreamReader`
(output) — or a message-level `Transport`. Raw OS pipe file objects are not accepted.

**[observed]** A third, lowest-level helper is exported: `spawn_stdio_transport`
(plus `spawn_stdio_connection`, `spawn_client_process`, `stdio_streams`) from
`src/acp/__init__.py`.

---

## 4. Lifecycle API surface and `session/update` delivery

**[observed]** Method names on `ClientSideConnection` (from
`src/acp/client/connection.py`; agent wire methods in `src/acp/meta.py`):

| Operation | Python method | JSON-RPC method |
| - | - | - |
| Initialize | `conn.initialize(protocol_version=..., client_capabilities=..., client_info=...)` | `initialize` |
| New session | `conn.new_session(cwd=..., mcp_servers=[], additional_directories=...)` → `.session_id` | `session/new` |
| Prompt | `conn.prompt(session_id=..., prompt=[text_block("...")])` → `PromptResponse` | `session/prompt` |
| Cancel | `conn.cancel(session_id=...)` | `session/cancel` (notification) |
| `session/update` | *delivered to your client*, see below | `session/update` (notification) |

Optional/other methods present in 0.12.1 include `authenticate`,
`load_session`, `list_sessions`, `set_session_mode`, `set_config_option`,
`fork_session`, `resume_session`, `close_session`, `delete_session`.

**[observed] `session/update` is delivered as an async callback method, not an
async iterator and not a `yield`.** The declaration in `src/acp/interfaces.py`:

```python
@param_model(SessionNotification, method=CLIENT_METHODS["session_update"], kind="notification")
async def session_update(
    self,
    session_id: str,
    update: UserMessageChunk | AgentMessageChunk | AgentThoughtChunk
        | ToolCallStart | ToolCallProgress | AgentPlanUpdate ... ,
    **kwargs: Any,
) -> None: ...
```

Your `Client` subclass implements it; the router registers it as a notification
route and calls it as each `session/update` frame arrives
(`build_client_router`, `src/acp/client/router.py`). Quoted official example,
`examples/client.py`:

```python
async def session_update(
    self,
    session_id: str,
    update: UserMessageChunk | AgentMessageChunk | ... ,
    **kwargs: Any,
) -> None:
    if not isinstance(update, AgentMessageChunk):
        return

    content = update.content
    text: str
    if isinstance(content, TextContentBlock):
        text = content.text
    ...
    print(f"| Agent: {text}")
```

**[observed]** The connection tracks in-flight `session_update` handlers and
`prompt()` awaits them before returning (success and error paths) —
`_SessionUpdateTracker` and `prompt()` in `src/acp/client/connection.py`.

**[observed]** The Quickstart's fuller lifecycle (also `examples/client.py`):

```python
conn = connect_to_agent(client_impl, proc.stdin, proc.stdout)

await conn.initialize(
    protocol_version=PROTOCOL_VERSION,
    client_capabilities=ClientCapabilities(),
    client_info=Implementation(name="example-client", title="Example Client", version="0.1.0"),
)
session = await conn.new_session(mcp_servers=[], cwd=os.getcwd())
...
await conn.prompt(session_id=session.session_id, prompt=[TextContentBlock(text=line)])
```

---

## 5. Client-side interface and defaults

**[observed]** The client interface is **`acp.interfaces.Client`**, a
`typing.Protocol` (re-exported as `acp.Client`). Installed-package probe on
0.12.1: `Client._is_protocol is True`; MRO is
`(acp.interfaces.Client, typing.Protocol, typing.Generic, object)`. The official
examples subclass it directly: `class SimpleClient(Client)` (Quickstart),
`class ExampleClient(Client)` (`examples/client.py`).

**[observed]** Methods the client may implement, from `src/acp/interfaces.py`
(JSON-RPC names in `src/acp/meta.py` `CLIENT_METHODS`):

- Baseline: `request_permission` → `session/request_permission`
- Notification: `session_update` → `session/update`
- Filesystem: `read_text_file` → `fs/read_text_file`; `write_text_file` →
  `fs/write_text_file`
- Terminal: `create_terminal`, `terminal_output`, `release_terminal`,
  `wait_for_terminal_exit`, `kill_terminal`
- Elicitation (unstable): `create_elicitation`, `complete_elicitation`
- Escape hatch: `ext_method`, `ext_notification`
- Hook: `on_connect(conn)`

**[observed] Default when you do not implement one.** I subclassed `Client` with
an empty body and called three unoverridden methods on the installed 0.12.1
package:

```
read_text_file returned: None      # fs/read_text_file
request_permission returned: None  # session/request_permission
```

So the default is a **silent `None` return**, not a helpful stub (no built-in
permission deny/allow, no filesystem implementation). There is no meaningful
"default policy" you can rely on — implement the methods your agent will call.

**[observed, routing nuance]** In 0.12.1 the client router registers
`terminal/*` routes as `optional=True` with `default_result=None` (or `{}` for
`release_terminal` / `kill_terminal`), but registers `fs/read_text_file`,
`fs/write_text_file`, and `session/request_permission` **without** `optional`
(`src/acp/client/router.py`). The router's fallback for a route whose handler is
absent is `raise RequestError.method_not_found(method)` (`src/acp/router.py`),
while an optional route returns its `default_result`. **[inferred]** Because
subclassing `Client` makes the inherited protocol stubs present, a plain
subclass hits the stub and returns `None`; a duck-typed object that omits the
attribute entirely would get `method_not_found` for the non-optional routes.
Either way, do not depend on a default: the official `examples/client.py`
overrides every one it does not support to
`raise RequestError.method_not_found("...")` explicitly, including
`request_permission`, `fs/read_text_file`, and `fs/write_text_file`.

---

## 6. Dependencies and runtime

**[observed]** Python floor/ceiling: `requires_python = ">=3.10,<3.15"`
(`pyproject.toml`; PyPI JSON `requires_python: "<3.15,>=3.10"`; classifiers list
3.10–3.14).

**[observed]** Declared runtime dependencies for released **0.12.1** (PyPI JSON
`requires_dist`):

```
pydantic>=2.7
logfire>=0.14; extra == "logfire"
opentelemetry-sdk>=1.28.0; extra == "logfire"
httpx[http2]>=0.27; extra == "http"
websockets>=12.0; extra == "http"
```

So the only mandatory runtime dependency is **pydantic**. Extras: `logfire`
(telemetry) and `http` (the experimental HTTP/WS transports).

**[observed]** The `main` branch `pyproject.toml` additionally lists
`pydantic-core>=2.18.1` as a direct dependency. This is a difference between the
released 0.12.1 metadata and current `main`; pydantic already pulls
pydantic-core in, so it does not change the installed tree.

**[observed] Measured dependency tree and size** (fresh venv, CPython 3.13,
`pip install agent-client-protocol==0.12.1`):

```
agent-client-protocol 0.12.1
annotated-types       0.8.0
pydantic              2.14.1
pydantic_core         2.50.1
typing_extensions     4.16.0
typing-inspection     0.4.4
```

Sizes: `acp/` ≈ **996 KB**; `pydantic/` ≈ 4.1 MB; `pydantic_core/` ≈ 5.1 MB;
total `site-packages` ≈ 24 MB including `pip`. **[inferred]** Real runtime
footprint of the SDK plus its deps is roughly **10 MB**, dominated by
pydantic + pydantic-core (the latter is a compiled wheel).

---

## 7. Version support: stable v1 and draft v2

**[observed] Stable ACP v1: yes.** `src/acp/meta.py` (generated) says
`# Schema ref: refs/tags/schema-v1.23.0` and `PROTOCOL_VERSION = 1`. The
installed 0.12.1 reports `PROTOCOL_VERSION = 1`. Both client and agent are
expected to negotiate with `initialize(protocol_version=PROTOCOL_VERSION)`.

**[observed] v2 (draft) is exposed only in the 1.0.0rc line, as an experimental
package.** `1.0.0rc2`'s release notes list "feat(v2)!: bump ACP draft schema to
2.0.0-alpha.5" and "feat(v2): add experimental runtime and negotiation"
(`https://api.github.com/repos/agentclientprotocol/python-sdk/releases`). In
`main`, `src/acp/experimental/v2/__init__.py` exports its own
`PROTOCOL_VERSION`, and `src/acp/experimental/v2/meta.py` says
`# Schema ref: refs/tags/schema-v2.0.0-alpha.5` with `PROTOCOL_VERSION = 2`.

**[observed] v2 is absent from the current stable release.** The installed
0.12.1 package has **no `acp/experimental/` directory** (probe:
`ls acp/experimental` → "No such file or directory"). So installing stable
0.12.1 gives you **v1 only**; v2 requires opting into a `1.0.0rc` prerelease.

**[observed]** A separate `use_unstable_protocol: bool = False` flag exists on
`connect_to_agent` / `spawn_agent_process` / `run_agent` to enable unstable
protocol methods; without it, unstable methods are routed but warn and raise
`method_not_found` (`src/acp/router.py`).

**[observed]** The SDK docs mark the remote **Web Transport (HTTP/WS)** explicitly
"**Experimental.** The remote web transports are experimental and may change"
(`https://agentclientprotocol.github.io/python-sdk/web-transport/`). That is
separate from v2 but in the same "not stable" bucket.

---

## 8. Stability / maturity signals

**[observed]** Version line: the current **stable release is `0.12.1` (0.x)**.
The `1.0.0` line is present only as prereleases: `1.0.0rc1` (2026-09-11),
`1.0.0rc2` (2026-09-21), `1.0.0rc3` (2026-10-12); GitHub marks each
`"prerelease": true`. **[observed]** No `1.0.0` final release exists as of
2026-10-13.

**[observed]** Last commit / push activity: `pushed_at` = **2026-10-12T09:38:13Z**;
repo `updated_at` = 2026-10-12T16:57:44Z (GitHub API `repos/agentclientprotocol/python-sdk`).
Created 2025-09-06.

**[observed]** Open issues: **2** (`open_issues_count: 2`; repo nav "Issues 2").

**[observed]** Popularity: **335 stars**, **51 forks**, **10 watchers/subscribers**.
Not archived, not disabled (`archived: false`).

**[observed]** The project does not label itself beta/experimental as a whole.
The docs label only specific subsystems: `acp.contrib` as "**Experimental**
utilities" (`https://agentclientprotocol.github.io/python-sdk/`) and the remote
web transports as Experimental. The stdio client/agent path carries no
experimental warning.

**[observed, maturity caveat]** The release history is a long 0.x series with
schema-driven breaking changes and migration guides (0.7, 0.8, 0.11). Example
commit subjects include "refactor: derive routers from protocol metadata",
"feat(schema)!: bump ACP v1 schema to 1.23.0", "refactor(v2)!: ..." (GitHub
releases API) — i.e. the API is still moving on the 0.x/rc line.

---

## Observed vs inferred vs not established

**Observed (read directly):** the PyPI JSON for `agent-client-protocol` (name,
version, upload times, `requires_python`, `requires_dist`, `ownership`); the
GitHub repo README, `pyproject.toml`, `LICENSE`, `src/acp/__init__.py`,
`src/acp/interfaces.py`, `src/acp/stdio.py`, `src/acp/transports.py`,
`src/acp/core.py`, `src/acp/meta.py`, `src/acp/router.py`,
`src/acp/client/router.py`, `src/acp/client/connection.py`,
`src/acp/experimental/v2/{__init__,meta}.py`, and the examples
`client.py`, `duet.py`, `echo_agent.py`; the GitHub repo metadata and releases
API; the SDK docs hub, Quickstart, and Web Transport pages. Also observed
directly: the installed 0.12.1 artifact (import name, `PROTOCOL_VERSION`,
`Client._is_protocol`, default method return values, absence of
`acp/experimental`, installed dependency set and sizes).

**Inferred:** that the PyPI owner-individual / org-owned split means the code is
officially org-owned but published from a maintainer's account; that the
practical default for an unimplemented `Client` method on a subclass is a `None`
return rather than an error (the router nuance is stated explicitly); that the
runtime footprint is ~10 MB.

**Not established (primary sources do not settle these):**
- How to embed the async SDK in a **synchronous/threaded** application. The SDK
  documents no sync facade and no threading guidance. The dedicated-event-loop
  + `run_coroutine_threadsafe` pattern is an inference, not a documented
  contract.
- Whether the maintainers consider the stdio client path production-ready. No
  stability statement beyond the version numbers and the experimental labels on
  `acp.contrib` and the remote transports.
- Whether `opencode acp` in particular speaks ACP over stdio, which ACP version
  it implements, and whether it interoperates with SDK 0.12.1's v1.23 schema.
  Out of scope here and not verified in this pass. (The sibling note
  `docs/research/acp-agent-integration.md` lists OpenCode as an ACP agent, but
  that is a listing, not an interoperability proof.)
- The date of a `1.0.0` final release (none exists yet).
- Why PyPI metadata omits the license while the repo declares Apache-2.0 — an
  inconsistency, not a resolved fact.

## What would settle the open items

- Maintainer docs or an issue confirming a supported way to drive the SDK from a
  synchronous thread (or a statement that none exists).
- The SDK's own tests/examples that run `spawn_agent_process` against a real
  external agent CLI (the Gemini bridge test is opt-in and gated by
  `ACP_ENABLE_GEMINI_TESTS=1`).
- The OpenCode repository / `opencode acp --help` output confirming the subcommand
  and its advertised ACP version.

## Recommendation

**[inferred, for `plan`/`architect`, not this report]** The evidence supports
that the official Python SDK is a real, org-owned ACP client implementation that
can spawn a local agent subprocess over stdio and surface `session/update`
streaming via an async callback — i.e. the shape the decision needs. The
evidence also shows it is **async-only** and that the stable release is v1-only
while v2 is prerelease. Whether a synchronous Flask app should embed it (event
loop in a background thread vs another approach) is an integration decision the
SDK does not answer; that decision belongs to `plan`/`architect`, and it should
be made knowing the SDK provides no synchronous facade and no documented
threading contract.
