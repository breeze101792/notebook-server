"""Synchronous ACP (Agent Client Protocol) client for the notebook server.

This module is the Flask-free half of the ACP provider: the backend is the
ACP *client*, it spawns an ACP agent subprocess (`opencode acp`, ...) and
drives one turn over stdio. It imports neither Flask nor app.py, so it can be
exercised against a stub agent with no server around it.

The ACP SDK (`agent-client-protocol`, import `acp`) is async-only while the
Flask request path is synchronous. One asyncio event loop runs forever on a
daemon thread; `run_turn` submits a coroutine to it and pumps the events the
coroutine's client callbacks enqueue. One agent process is spawned per turn:
that keeps the server request-stateless (the browser owns the conversation),
so initialize -> session/new -> prompt all happen inside a single
`run_turn` and the child is killed when it returns. The stdin-EOF backstop is
the agent's contract: when this server dies for any reason, the child's stdin
closes and a conforming agent exits, so no orphan outlives the server.
"""

import asyncio
import logging
import os
import queue
import threading

import acp
from acp import spawn_agent_process, text_block
from acp import schema as acp_schema
from acp.interfaces import Client

_log = logging.getLogger(__name__)

# --- Protocol / lifecycle constants (all magic numbers live here) ---------- #
# Version this client speaks; track the SDK constant rather than a literal so a
# SDK bump that changes the wire version is a deliberate review point.
ACP_PROTOCOL_VERSION = acp.PROTOCOL_VERSION
# Wall-clock cap for one turn. ACP agents run their own multi-step tool loop
# inside a single prompt, so this is deliberately generous; it only exists to
# contain a silent or wedged agent.
ACP_TURN_TIMEOUT_DEFAULT = 900  # seconds
# How often run_turn polls the event queue; also the SSE keep-alive cadence.
ACP_POLL_INTERVAL = 0.5  # seconds
# Events buffered per turn. The agent must never block on a slow reader, so a
# full queue flips an overflow flag that ends the turn with an error instead.
ACP_QUEUE_MAX = 4096
# client_info sent at initialize: a stable name/version for the agent's logs.
ACP_CLIENT_NAME = "notebook-server"
ACP_CLIENT_VERSION = "1.0"

_LOOP_LOCK = threading.Lock()
_LOOP = None


class _Client(Client):
    """ACP client callbacks for one turn: stream updates, auto-allow tools.

    The SDK invokes these on the event-loop thread. `session_update` only
    translates and enqueues (never awaits), so the agent is never stalled by a
    slow reader. v1 surfaces only `agent_message_chunk`; thought / tool-call /
    plan / usage / mode updates are dropped silently, not treated as errors,
    so a later renderer can add them without changing this contract.
    """

    def __init__(self, events):
        self.events = events
        self.overflowed = False

    def _enqueue(self, event):
        """Non-blocking put; a full queue flips the overflow flag instead."""
        try:
            self.events.put_nowait(event)
        except queue.Full:
            self.overflowed = True

    async def session_update(self, session_id, update, **kwargs):
        kind = update.session_update
        if kind == "agent_message_chunk":
            text = getattr(getattr(update, "content", None), "text", None)
            if isinstance(text, str) and text:
                self._enqueue({"type": "text", "text": text})
        elif kind == "tool_call":
            # One trace line per tool the agent starts, so a long multi-step
            # turn shows activity instead of looking wedged. Progress updates,
            # thoughts, plans and usage stay dropped in v1: they are noisy and
            # the trace line already names what is running.
            title = getattr(update, "title", None)
            if isinstance(title, str) and title.strip():
                self._enqueue({"type": "trace", "text": title.strip()})

    async def request_permission(self, session_id, tool_call, options, **kwargs):
        """Auto-allow the agent's tool calls (single-user, trusted agent).

        Prefer a one-shot allow over a standing one, since a fresh process is
        spawned every turn. If the agent offers no allow option, deny rather
        than pretend.
        """
        allow_once = None
        allow_always = None
        for option in options or []:
            if option.kind == "allow_once" and allow_once is None:
                allow_once = option
            elif option.kind == "allow_always" and allow_always is None:
                allow_always = option
        chosen = allow_once or allow_always
        if chosen is None:
            return acp_schema.RequestPermissionResponse(
                outcome=acp_schema.DeniedOutcome(outcome="cancelled"))
        # AllowedOutcome (a SelectedPermissionOutcome subclass) is required:
        # the response union is discriminated on outcome="selected".
        return acp_schema.RequestPermissionResponse(
            outcome=acp_schema.AllowedOutcome(
                option_id=chosen.option_id, outcome="selected"))

    # We advertise no fs or terminal capability, so a conforming agent never
    # calls these. The Protocol base methods exist and return None/{} which the
    # SDK would encode as a bogus success the agent cannot use -- so override
    # them to fail loudly with the protocol's own method-not-found error.
    async def read_text_file(self, session_id, path, line=None, limit=None, **kwargs):
        raise acp.RequestError.method_not_found("fs/read_text_file")

    async def write_text_file(self, session_id, path, content, **kwargs):
        raise acp.RequestError.method_not_found("fs/write_text_file")

    async def create_terminal(self, session_id, command, args=None, env=None,
                              cwd=None, output_byte_limit=None, **kwargs):
        raise acp.RequestError.method_not_found("terminal/create")

    async def terminal_output(self, session_id, terminal_id, **kwargs):
        raise acp.RequestError.method_not_found("terminal/output")

    async def release_terminal(self, session_id, terminal_id, **kwargs):
        raise acp.RequestError.method_not_found("terminal/release")

    async def wait_for_terminal_exit(self, session_id, terminal_id, **kwargs):
        raise acp.RequestError.method_not_found("terminal/wait_for_exit")

    async def kill_terminal(self, session_id, terminal_id, **kwargs):
        raise acp.RequestError.method_not_found("terminal/kill")

    async def create_elicitation(self, message, mode, **kwargs):
        # Same reasoning: elicitation is a capability we do not advertise, and
        # the base returns None, which the SDK encodes as an empty success.
        raise acp.RequestError.method_not_found("elicitation/create")


def _get_loop():
    """Return the module's one asyncio loop, creating it on first use.

    `asyncio.run` cannot be nested and would build a fresh loop per turn, so
    instead a single loop runs forever on a daemon thread and every turn
    submits its coroutine to it. The thread is a daemon on purpose: it must
    never keep the process alive, and an unfinished turn dies with the server
    anyway (the agent sees stdin EOF).
    """
    global _LOOP
    with _LOOP_LOCK:
        if _LOOP is None:
            loop = asyncio.new_event_loop()
            threading.Thread(
                target=loop.run_forever, name="acp-loop", daemon=True,
            ).start()
            _LOOP = loop
        return _LOOP


async def _drive(client, command, args, cwd, env, prompt, timeout):
    """Run one ACP turn: spawn -> initialize -> session/new -> prompt.

    The terminal event is enqueued only in the finally, *after* the spawn
    context manager has exited, so the SDK's subprocess kill ladder always
    runs to completion before the caller can return and cancel the task.
    Enqueues at most one terminal event (done or error); a cancellation by a
    caller that has gone away emits none.
    """
    outcome = None
    emitted = False
    cancelled = False

    def finish(event):
        """Enqueue the single terminal event; a later call is a no-op."""
        nonlocal emitted
        if emitted:
            return
        emitted = True
        client._enqueue(event)

    def record(event):
        """Remember the terminal outcome; the first one wins."""
        nonlocal outcome
        if outcome is None:
            outcome = event

    try:
        # The SDK leaves the child's stderr on an undrained pipe by default,
        # which deadlocks an agent that logs heavily. Inherit our stderr
        # instead -- we never parse it, so nothing is lost and nothing fills.
        async with spawn_agent_process(
                client, command, *args, cwd=cwd, env=env,
                transport_kwargs={"stderr": None}) as (conn, _proc):
            init = await conn.initialize(
                protocol_version=ACP_PROTOCOL_VERSION,
                client_capabilities=None,
                client_info=acp_schema.Implementation(
                    name=ACP_CLIENT_NAME, version=ACP_CLIENT_VERSION))
            offered = getattr(init, "protocol_version", None)
            if offered != ACP_PROTOCOL_VERSION:
                record({"type": "error", "message": (
                    "ACP protocol version mismatch: agent offered %s, "
                    "client requires %d" % (offered, ACP_PROTOCOL_VERSION))})
                return
            session = await conn.new_session(
                cwd=str(cwd) if cwd else os.getcwd(), mcp_servers=[])
            result = await asyncio.wait_for(
                conn.prompt(session_id=session.session_id,
                            prompt=[text_block(prompt)]),
                timeout=timeout)
            record({"type": "done",
                    "stopReason": str(getattr(result, "stop_reason", ""))})
    except asyncio.CancelledError:
        # Caller disconnected; re-raise so the context manager unwinds and
        # runs the kill ladder. No terminal event -- no reader remains.
        cancelled = True
        raise
    except (asyncio.TimeoutError, TimeoutError):
        record({"type": "error",
                "message": "ACP turn timed out after %s seconds" % timeout})
    except FileNotFoundError:
        # Never echo the configured command line to the browser; log it.
        _log.warning("ACP agent command not found: %r", command)
        record({"type": "error", "message": "ACP agent failed to start"})
    except OSError as exc:
        _log.warning("ACP agent failed to start: %s", exc)
        record({"type": "error", "message": "ACP agent failed to start"})
    except Exception as exc:  # acp.RequestError, JSON-RPC errors, ...
        _log.warning("ACP turn failed: %s", exc)
        record({"type": "error", "message": "ACP turn failed"})
    finally:
        # Runs after the async-with teardown above (or after a spawn failure),
        # so the terminal event marks a turn whose kill ladder has already
        # finished. On cancellation there is no reader left to notify.
        if not cancelled:
            finish(outcome or {
                "type": "error",
                "message": "ACP agent stopped before completing the turn"})


def run_turn(command, args=(), cwd=None, env=None, prompt="", timeout=None,
             keepalive=False):
    """Drive one ACP turn against `command` and yield its events.

    Yields:
      {"type": "text", "text": str}        streamed agent message text
      {"type": "done", "stopReason": str}  prompt completed
      {"type": "error", "message": str}    any failure

    plus, only when `keepalive` is true, an internal {"type": "ping"} on each
    idle poll. The ping is not an agent event: it lets an SSE pump emit a
    keep-alive for a long silent turn, and it is also the yield point at which
    a client disconnect is delivered, which is how GeneratorExit cancels the
    in-flight turn. It is off by default so a direct caller sees exactly the
    three real event types.

    A synchronous generator so the Flask request thread can consume it
    directly; the work runs on the module event loop and this only pumps the
    queue with ACP_POLL_INTERVAL. Exactly one terminal event is always
    produced, including on a crash, a timeout, a bad command, or a non-zero
    child exit.
    """
    loop = _get_loop()
    events = queue.Queue(maxsize=ACP_QUEUE_MAX)
    client = _Client(events)
    effective_timeout = ACP_TURN_TIMEOUT_DEFAULT if timeout is None else timeout
    future = asyncio.run_coroutine_threadsafe(
        _drive(client, command, tuple(args), cwd, env, prompt, effective_timeout),
        loop)
    terminal_seen = False
    try:
        while True:
            if client.overflowed:
                yield {"type": "error",
                       "message": "ACP event queue overflowed; turn aborted"}
                return
            try:
                event = events.get(timeout=ACP_POLL_INTERVAL)
            except queue.Empty:
                # Liveness: if the coroutine has finished and events.empty()
                # proves no terminal event is queued (the terminal is enqueued
                # before the coroutine returns), stop instead of polling on.
                if future.done() and events.empty() and not terminal_seen:
                    yield {"type": "error",
                           "message": "ACP turn ended without a result"}
                    return
                if keepalive:
                    yield {"type": "ping"}
                continue
            yield event
            if event.get("type") in ("done", "error"):
                terminal_seen = True
                return
    except GeneratorExit:
        # Browser hung up (Stop button, tab close). Drop the coroutine; the
        # SDK's spawn context manager then runs its kill ladder.
        future.cancel()
        raise
    finally:
        if not future.done():
            future.cancel()
