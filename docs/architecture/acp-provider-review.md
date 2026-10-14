# ACP provider — architecture review of the proposed design

Review of the plan to add the Agent Client Protocol (ACP) as a second
provider type peer to the OpenAI-compatible profiles. Read against the real
code on 2026-10-13. This is a design review, not an implementation.

> **SUPERSEDED (as built, 2026-10-13).** This review predates the build, and
> the shipped provider differs from the design below. Read
> [ai-assistant.md](ai-assistant.md#acp-providers) for the as-built contract.
> As-built deltas:
>
> - Uses the official `agent-client-protocol` (0.12.1) Python SDK; JSON-RPC is
>   not hand-rolled.
> - Config is a separate, hand-edited `config/acp.json`, not a `type` field
>   merged into `config/ai.json`, and is never written by any route.
> - No `POST /api/ai/acp/permission` route, no held writes, and no `fs/*`
>   advertisement; the client advertises no fs, terminal, or elicitation
>   capability.
> - Tool-call permission is auto-allowed (`allow_once`), not surfaced as a
>   review card.
>
> Still standing from this review: the `acp_client.py` module boundary
> (Flask-free, imports no `app.py`), one agent process per turn, the SSE
> transport reuse, and the stdin-EOF backstop for orphaned agents.

## 0. Verdict

The proposed design is structurally right: `acp_client.py` as a separate,
Flask-free module; the backend as the ACP client (the protocol requires the
client to launch the agent over stdio, and the browser cannot); one
translated SSE stream out of `/api/ai/chat`; held-write approval enforced
server-side. Three amendments are required:

1. **The SSE relay generator must never block on an agent round-trip.**
   Approval cards travel *on the same SSE stream* they gate — if the
   generator waits on a held request's future, the card can never reach the
   browser and the turn deadlocks (§4, §5).
2. **One agent process per `/api/ai/chat` request**, not per profile or per
   session, for v1. It preserves the app's stateless-server invariant and
   contains every crash/config/restart failure; a warm pool is a later,
   contained addition behind the same seam (§6).
3. **Drop `POST /api/ai/acp/cancel`.** The browser abort (Stop button,
   `AbortController`) already delivers `GeneratorExit` in the relay — the
   same mechanism today's relay relies on (`app.py:1558`) — and that is the
   natural cancel path. One route (`/api/ai/acp/permission`), one mechanism
   (§7).

## 1. Goal, constraints, platform

Restated: the single-user notebook server gains ACP agents as a second
provider type. The Flask backend (`app.py`, ~2617 lines, stdlib + Flask +
bcrypt only) becomes the ACP client: it spawns the agent subprocess, speaks
JSON-RPC 2.0 over stdio (initialize → session/new → session/prompt, streamed
`session/update` notifications, client-bound requests), and relays the turn
to the browser as SSE. The browser (`static/js/ai.js`) keeps owning the
conversation and renders writes/permissions as Apply/Reject cards.

Hard constraints from the codebase:

- No new dependencies (`requirements.txt` = Flask 3.0.3 + bcrypt 5.0.0);
  `acp_client.py` must be stdlib-only (subprocess/threading/queue/json) — the
  proposal is right.
- Dev server only: `app.run(...)` at `app.py:2617`. Werkzeug threading facts
  verified in the installed venv: Flask sets `threaded=True` by default
  (flask/app.py:618 `options.setdefault("threaded", True)`), and Werkzeug's
  threaded server runs each request on a **daemon** thread
  (werkzeug/serving.py:877 `daemon_threads = True`). No process manager, no
  supervisor.
- The server is request-stateless today: every `/api/ai/chat` POST carries
  the full conversation (`static/js/ai.js:1258`), nothing about a turn
  survives the request. ACP must not silently break this (§6).
- `safe_path` (`app.py:156`) is the only path chokepoint; `atomic_write`
  (`app.py:237`) is the only write mechanism. Both are reused, not
  re-implemented.
- Single user, LAN-facing, auth optional (`admin_required` bypasses entirely
  when auth is off — `app.py:654-670`). This bites for `command` execution
  (§8).

## 2. Module boundary: yes, `acp_client.py` — and the seam is "no Flask, no app.py"

The single-file convention is deliberate, but `app.py` is routes + pure
functions over request-scoped state; the largest thing in it is a ~100-line
route. An ACP client is a different animal: a process-owning, multi-threaded,
stateful protocol engine with a kill ladder and a registry that outlives the
request that started it (held approvals are resolved by a *second* HTTP
request). Inlining ~400-600 lines of that into `app.py` would make every
future route edit tiptoe around module-global threading state. Extract.

The seam, precisely:

| Lives in `acp_client.py` | Lives in `app.py` |
| --- | --- |
| `AcpAgent`: spawn (`command` + `args`, own process group), stdin writer with one lock, stdout reader thread, stderr drain, request-id → future map | Routes: the `/api/ai/chat` type branch, `/api/ai/acp/permission`, probe branch |
| `AcpTurn`: event queue, done flag, pending-approval registry `{request_id: entry}`, turn id | `/api/ai/*` auth decorators, JSON validation of the POST body |
| JSON-RPC framing/correlation both directions; EOF → resolve-all-with-error cleanup | fs policy: read through `safe_path`-equivalent bounds, approved writes through `atomic_write` |
| Pure translation helpers: ACP update params → wire event dicts (no Flask) | SSE framing + `Response(...)` envelope reuse (`app.py:1576-1578`) |
| Turn registry: `{turn_id: AcpTurn}` + atexit kill-all | Config: `_sanitize_server`, `_public_ai_config`, `Upstream` dataclass |

Two rules keep the boundary clean:

1. **`acp_client.py` imports neither Flask nor `app.py`.** Everything
   environment-specific is injected: the fs handlers (`read(path)`,
   `write_pending(entry)`), the update sink, spawn cwd. This makes
   `acp_client` unit-testable with a ~50-line stdlib stub agent speaking
   JSON-RPC over stdio — the same testing posture as `_StubOpenAIHandler`
   (`tests/test_app.py:2648-2664` starts a real loopback HTTP server; the
   ACP analog is a subprocess, which is even cheaper).
2. **No circular import**: `app.py` imports `acp_client`, passes callables
   in. The fs read handler answers inline (bounded disk read); the fs write
   handler registers a pending approval and returns *immediately* (§5).

## 3. Threading model

```mermaid
flowchart LR
    subgraph Flask dev server, threaded=True, daemon threads
        R1[POST /api/ai/chat\nrequest thread] --> GEN[SSE relay generator\npumps turn queue]
        R2[POST /api/ai/acp/permission\nrequest thread] --> REG
    end
    subgraph acp_client
        GEN --> Q[(turn event queue,\ncapped)]
        RD[reader thread\nstdout.readline] --> Q
        RD --> FUT[request-id to future map]
        RD --> REG[(pending approval registry)]
        WR[stdin writer,\none lock]
        R1 -.initialize / session/new / session/prompt.-> WR
        R2 -.resolve pending.-> WR
        ERR[stderr drain thread\nor redirect] -.log.-> LOG[(server log)]
    end
    WR --> ACP[(agent subprocess,\nown process group)]
    ACP --> RD
```

What must be true, verified against this stack:

- **The relay generator runs on a per-request daemon thread.** Flask's dev
  default is `threaded=True` (flask/app.py:618), so a blocking SSE generator
  never blocks the server — the existing relay already exploits this
  (`app.py:1549-1578`). No change needed; this is a documented dependency,
  not something to fix.
- **Client disconnect reaches the generator as `GeneratorExit`** (Werkzeug
  calls `Response.close()` on disconnect; precedent: `app.py:1558`'s comment
  and handler). The ACP relay's `finally` must: send `session/cancel`,
  resolve all pending approvals as denied, then run the kill ladder (§6).
- **Reader thread must never block.** `proc.stdout.readline()` is its only
  wait. Every client-bound request is either answered inline with bounded
  work (fs read) or registered in the pending registry and deferred
  (fs write, `session/request_permission`). Nothing in the reader path may
  wait on the browser — see §5 for the deadlock proof.
- **One stdin writer lock.** Initialize/prompt (request thread), approval
  responses (permission route thread), and cancel (generator teardown) all
  write JSON-RPC; interleaved writes would corrupt the stream. BrokenPipeError
  on a dead child → fail the turn, resolve all pendings.
- **Daemon-thread caveat**: Werkzeug's request threads are daemon threads
  (werkzeug/serving.py:877) and so should `acp_client`'s reader be — but
  daemons die without cleanup, so the *only* reliable cleanup triggers are
  EOF (child died → reader resolves everything with errors) and the atexit
  killpg (§6). Never rely on thread shutdown for correctness.
- **No asyncio anywhere.** Correct for this repo: everything is I/O-bound,
  stdlib threads match the codebase's synchronous style, and the futures map
  is tiny (initialize/session/prompt + held pendings).

## 4. The SSE relay for ACP: pump, never fetch

The generator for an ACP turn is *not* a relay of an upstream connection
(like `app.py:1549`); it is a queue pump:

- Reader thread translates `session/update` params into wire event dicts and
  pushes them on the turn queue; the `session/prompt` **response** (StopReason)
  resolves the prompt future, sets `turn.done`, and pushes a sentinel.
- Generator loop: `queue.get(timeout≈0.5)` → yield `data: <json>\n\n` frames;
  on sentinel, drain remaining events and return.
- In-band errors reuse the existing convention *exactly*: `event: error` +
  `{"error": true, "status", "message"}` frames (`app.py:1569-1574`), so
  `static/js/api.js:141-148` handles ACP failures without change.
- Same response envelope: `text/event-stream`, `Cache-Control: no-store`,
  `X-Accel-Buffering: no` (`app.py:1576-1578`).
- Optional but cheap: a `: keep-alive` comment frame every ~15 s so a silent
  agent turn (long tool call, no chunks) cannot be dropped by an intermediary.

## 5. Held writes and multiple in-flight requests: sound, with one rule

The future/dispatcher design is sound — it is the standard LSP/JSON-RPC
stdio pattern — **provided the reader thread never blocks on a held
request**. The deadlock to design against:

> Agent sends `fs/write_text_file` (request id 7), then more
> `session/update` notifications. If the reader thread answers requests
> synchronously, it now waits for the browser. Meanwhile the approval card is
> supposed to reach the browser *through the SSE stream the reader is no
> longer feeding*. The queue starves, the card never renders, the user never
> clicks, the agent never finishes: a distributed deadlock with no timeout.

The rule that kills it: **any client-bound request whose answer requires the
browser is registered in the pending registry and answered later, from the
`POST /api/ai/acp/permission` request thread.** The reader keeps parsing;
the card reaches the browser; the user resolves it; the permission thread
writes the JSON-RPC response through the writer lock; the agent continues.

Remaining soundness points:

- **Other requests keep flowing while one is held** — exactly what the
  request-id → future map gives. `initialize`/`session/new`/`session/prompt`
  are strictly sequential by protocol, so the map holds at most a handful of
  entries; no starvation scenario exists.
- **Pending resolution is once-only and idempotent** (double-click, two
  tabs): the registry entry is removed under the turn lock; the second POST
  gets 409/404. The server performs the write itself (`atomic_write`) with
  the content captured at request time — the card can only ever approve what
  it displayed, which closes the TOCTOU the current client-side patch cards
  have (client previews at `ai.js`, server re-checks at `app.py:1919`).
- **Turn-level timeout is the containment for an abandoned card**: if the
  user walks away, the prompt deadline fires → cancel → all pendings auto-
  denied → agent told "denied", stream ends with an error/stop event. No
  separate held-request timeout needed.
- **EOF is the universal cleanup**: child exits → reader sees EOF → resolve
  every future and pending with errors, set `done`, push sentinel. One
  code path, no scattered frees.

## 6. Process lifecycle

**Recommendation: one agent process per `/api/ai/chat` request.** Spawn at
turn start (initialize → session/new), kill at turn end (StopReason,
error, timeout, or client abort). Consequences:

- The server stays request-stateless — the same invariant the OpenAI path
  has (the browser owns the conversation, `ai.js:1258` re-uploads it). For
  ACP the route flattens the POSTed messages into one prompt for a fresh
  session each turn; cross-turn memory stays in the browser, not the server.
  This is honest for v1: the ACP provider behaves as a stateless
  "agent with provided context".
- Per-profile / per-session / idle-TTL pools are deferred — a warm pool
  buys startup latency (seconds for real agents) but costs TTL eviction,
  crash restarts, config invalidation, and restart-on-edit logic. YAGNI for a
  single-user notebook. The `AcpAgent.start/stop` seam makes a pool a later
  contained change (key: hash of `command`+`args`, invalidated by
  `POST /api/ai/config`).
- Concurrent turns on one profile are naturally isolated processes; the
  turn registry is keyed by turn id (echoed in SSE, required by the
  permission POST), so no "only one live turn" assumption is needed. Do not
  add a busy/409 cap in v1 — nothing contends.

Kill ladder and orphans:

- Spawn with `start_new_session=True` (own process group) so killing the
  agent can never take the Flask server down.
- Stop = `session/cancel` → wait ≤5 s for exit → SIGTERM pgid → wait ≤2 s →
  SIGKILL pgid. Constants grouped at the top of `acp_client.py`.
- `atexit` handler kills every live agent's process group (module-level live
  set). This covers Ctrl+C (KeyboardInterrupt → atexit runs).
- **SIGTERM skips atexit.** Under `--debug`, the Werkzeug reloader restarts
  the child server with SIGTERM — the atexit kill will not run. The
  backstop that always works: the agent's stdin pipe closes when the server
  dies, and stdio transports must exit on EOF. Document this as a required
  property of any ACP agent (all mainstream ones do), test it, and note
  the `--debug` caveat in operations docs. Do not add a SIGTERM handler to
  fight the reloader — `--debug` is already documented as
  dev-only/loopback-advised (`app.py:2613-2616`).
- **Server restart mid-turn** (the asked failure mode): the child dies with
  the server; the browser sees the stream drop and renders it as a failed
  request (`ai.js:1261-1282` already handles stream errors); after restart
  the in-memory registry is gone so a late permission POST 404s and the
  stale card turns errored. Acceptable and expected for a single-user tool;
  write it down rather than designing persistence around it.

## 7. Routes and transport dedup — what is reused verbatim

**Reuse the SSE transport end-to-end; only the event vocabulary grows.**

- Server: keep `/api/ai/chat` as the single chat entry point, branching on
  profile `type` (`ai_chat`, `app.py:1505`). The ACP branch produces the
  same envelope (`app.py:1576-1578`) and the same in-band error frames
  (`app.py:1569-1574`). The OpenAI branch is untouched.
- Client: extend, don't fork, `NB.api.aiChat` (`static/js/api.js:102-156`).
  It already tolerates unknown data frames (parses every `data:` line,
  ignores objects without a delta at `api.js:149-153`), so ACP events ride
  the same framing: each translated update is one `data: {json}` line whose
  payload carries an ACP discriminator (`{"acp":"message"|"thought"|
  "tool"|"card", ...}`); `agent_message_chunk` maps onto the existing
  OpenAI delta shape so the streaming render path is reused unchanged. Add
  an optional event callback parameter so ACP events reach `ai.js`.
- The six-tool contract does not apply to ACP agents: the agent brings its
  own tools; we advertise only `fs.readTextFile`/`fs.writeTextFile` (and
  no `terminal/*`) at initialize. `systemPrompt()` (`ai.js:827`) branches by
  provider type: ACP gets the notebook context, the custom prompt, and the
  renderer/fenced-language section (which the registry-completeness test
  pins — keep it in both branches), but **not** the ` ```nb-tool ` contract.
- `MAX_TOOL_ROUNDS` (`ai.js:54`) is meaningless for ACP (the agent runs its
  own loop inside one turn); its server-side analog is the turn timeout
  (§6). The frontend's `runToolLoop` (`ai.js:1239`) branches: an ACP turn
  is one `aiChat` call whose events render bubbles, thought/tool trace
  lines (same DOM vocabulary as `.ai-tool-trace`), and cards; the stream
  end finalizes the turn.

**Routes that must exist**: only `POST /api/ai/acp/permission` with
`{turnId, requestId, decision: "allow"|"deny"}` (`@admin_required` like
every `/api/ai/*` route). It resolves *both* held `fs/write_text_file`
requests and held `session/request_permission` — one pending mechanism, one
card shape, two renderings. On allow-write, the server itself runs
`atomic_write` (`app.py:237`) and then answers the agent; on deny, answer
with the deny outcome. Emit `NB.evt("ai:applied", {path})` from the card's
apply handler so `viewer.js`'s cache refresh keeps working unchanged.

**Cut from the proposal**: `POST /api/ai/acp/cancel`. The Stop button is an
`AbortController` abort (`ai.js:1260` → `api.js:108`), which the server sees
as a disconnect → `GeneratorExit` in the generator (the exact mechanism
today's relay uses, `app.py:1558`) → cancel + kill ladder. A separate cancel
route would be a second mechanism for the same outcome. Add it later only
if a "cancel without dropping the stream" need ever materializes.

Also cut from v1 (seams exist, needs don't): warm process pool (§6),
server-side session continuity across turns (would break the stateless
invariant; revisit with a client-supplied conversation id + TTL registry
only if flattened prompts prove insufficient), elicitation cards
(auto-respond "cancelled" + a trace event), terminal advertisement
(unadvertised methods are rejected with JSON-RPC -32601 — that *is* the
enforcement point for non-compliant agents).

### Files/functions that change (the checklist)

| File | Change |
| --- | --- |
| `app.py:1195` | `Upstream` dataclass: add `type` (default `"openai"`), `command`, `args` |
| `app.py:1231` | `_sanitize_server`: type-conditional validation (§8) |
| `app.py:1284` | `_public_ai_config`: echo `type`/`command`/`args` (not secrets) for UI round-trip |
| `app.py:1310` | `_saved_server`: unchanged lookup, callers read `type` |
| `app.py:1505` | `ai_chat`: branch on type; ACP branch = flatten messages, drive `AcpAgent`, pump queue |
| `app.py:1414` | `ai_probe`: ACP branch = spawn + initialize + report protocol version, then kill |
| new | `POST /api/ai/acp/permission` route |
| new `acp_client.py` | everything in §2/§3 |
| `static/js/api.js:102` | `aiChat`: optional event callback (additive, default keeps OpenAI behavior) |
| `static/js/ai.js:827` | `systemPrompt`: provider-type branch (keep renderer docs in both) |
| `static/js/ai.js:1239` | `runToolLoop`: type branch → `runAcpTurn` |
| `static/js/ai.js:2179/2215` | `loadAiConfig` + picker label: type-aware (`s.model \|\| s.baseUrl` shows nothing for ACP; use the command basename) |
| `static/js/settings.js` (AI tab, refs at `settings.js:986`, add/edit at `1390-1466`) | profile editor gains type/command/args; Test button uses the ACP probe |
| `docs/contracts/http-api.md`, `docs/contracts/configuration.md`, `docs/architecture/ai-assistant.md`, `CLAUDE.md` | contract + as-built updates (CLAUDE.md when the code lands, not now) |
| `tests/test_app.py` | `TestAiConfig` gains ACP `_sanitize_server` cases; new `TestAcpChat` with a stdlib stub agent subprocess (pattern of `TestAiChat` at `tests/test_app.py:2648`) |
| `tests/dom/test_dom.js` | `== ai ==` block: ACP SSE streams via the existing `aiChatStreams` queue (`tests/dom/test_dom.js:1380-1384` already plays arbitrary frames) |

`agent.md` does not change: it documents the external-agent HTTP API, and
external agents never call `/api/ai/*`.

## 8. Config schema and `_sanitize_server` — the command-execution question

Schema (stored snake_case, uniform for both types so every consumer stays
shape-stable):

```jsonc
{"servers": [
  {"name": "claude-code", "type": "acp",
   "command": "/usr/local/bin/claude", "args": ["--acp"],
   "base_url": "", "api_key": "", "model": ""},
  {"name": "local", "type": "openai",
   "base_url": "http://localhost:11434", "api_key": "", "model": "llama3"}
]}
```

Validation changes in `_sanitize_server` (`app.py:1231`):

- `type` ∈ `{"openai", "acpi"}`-style allowlist, default `"openai"` so the
  existing stored profiles (no `type` key) and the load path
  (`load_ai_config`, `app.py:1204`) stay backward compatible.
- Today `baseUrl` is unconditionally required (`app.py:1240-1241`) — make
  it required only for `type == "openai"`.
- For `type == "acp"`: `command` is a non-empty string ≤ 300 chars and is
  **argv[0] only — never a shell string** (no `shell=True`, ever; spaces in
  `command` are a literal path problem, not arg splitting). Resolve it at
  spawn time: absolute path must exist and be executable, else
  `shutil.which()` (PATH comes from the server environment — document that).
  `args` is a list of strings, ≤ 32 items, each ≤ 1000 chars, each free of
  NUL/newline; anything non-string is a 400. These bounds are about
  foot-guns and memory, not security theater.
- Probe/spawn failures surface as data, never 500s (the probe route's
  existing pattern: `ok: false` with HTTP 200, `app.py:1448-1452`).

**Is admin-gating sufficient?** While auth is on: yes — the admin is the
machine owner and could run the command themselves. While auth is **off**
(the shipped default): no honest reading says yes. Today an open server
leaks notes and spends a stored key (the documented posture,
`docs/architecture/ai-assistant.md:22-26`); a `command` field turns any LAN
client into remote command execution *as the server's user*. That is a
different class, not a louder version of the same one.

Recommendation: **reject `type: "acp"` profiles in `POST /api/ai/config`
while `auth_enabled()` is false** — error: "set an admin password before
adding ACP agents". Tests needing ACP write `auth.json` the way `TestAuth`
does (`tests/test_app.py` `TestAuth` pattern). Flagging as an open decision
because it is a product posture call, but the default must not be
"LAN-writable RCE".

## 9. Failure modes to design against

Each row names the bug class and the structural prevention.

| # | Failure | Bug class | Prevention (where) |
| --- | --- | --- | --- |
| 1 | Reader blocks on a held request → approval card never reaches browser | distributed deadlock | Pending-registry rule: browser-dependent answers never block the reader (§5) |
| 2 | Child writes to stderr, nobody drains it → pipe buffer fills → agent hangs | fd leak / pipe deadlock | Dedicated stderr drain (thread → log, or redirect to a file) in `AcpAgent` |
| 3 | Agent emits garbage / a line with no newline → `readline()` grows forever | unbounded input → OOM | Per-line cap (~1 MiB); discard + fail the turn past it |
| 4 | Server dies (SIGKILL/SIGTERM/reloader) → orphaned agent | orphaned process | Own process group + atexit killpg + stdin-EOF contract (§6) |
| 5 | Child exits mid-turn → futures/pendings never resolve | thread/future leak | EOF = single-point cleanup: resolve-all-with-error, set done, sentinel (§5) |
| 6 | Agent floods `session/update` faster than the browser reads | unbounded queue → OOM | Queue cap (~1000 events) → fail the turn with an error frame |
| 7 | Card approved after the turn died (restart, timeout, second tab) | stale reference | Registry keyed by turn id; dead turn → 404; card turns errored |
| 8 | Double-resolve of one requestId (double-click, two tabs) | TOCTOU/idempotency | Resolve-once under turn lock; second POST 409 |
| 9 | Agent ignores `session/cancel` | hostile/buggy child | Kill ladder: cancel → 5 s → SIGTERM pgid → 2 s → SIGKILL pgid |
| 10 | Agent calls unadvertised `terminal/*` | capability escape | Not advertised at initialize + JSON-RPC -32601 response — the protocol's own enforcement |
| 11 | Agent writes outside the notebook (`fs/write_text_file` on `/etc/...`) | path traversal | Server-side bounds check mirroring `safe_path`'s boundary rule (`app.py:192-195`), extracted into one shared predicate used by both callers; out-of-bounds → error response, never a card |
| 12 | Prompt never completes (silent agent) | unbounded wait | Turn deadline (constants with the others) → cancel → in-band error event |
| 13 | Profile edited mid-turn | config race | Per-request process snapshot; new turns see new config, running turn unaffected |
| 14 | Flattened prompt exceeds body/prompt caps | resource abuse | `MAX_REQUEST_BYTES` already bounds the POST (`app.py:66`); cap the flattened prompt server-side (~8 MiB) |

## 10. Open questions (decide before implementation)

1. **Auth-off policy for ACP profiles** (§8): accept the recommendation
   (ACP requires auth enabled) or override it — this is the one product
   posture call in the design.
2. **Turn timeout value**: 10 minutes vs 15. Real agents doing multi-file
   work can run long; the number should be a constant, not a per-request
   knob (YAGNI).