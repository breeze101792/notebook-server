#!/usr/bin/env python3
"""Stdlib-only stub ACP (Agent Client Protocol) agent for the test suite.

It speaks newline-delimited JSON-RPC 2.0 on stdin/stdout and drives nothing --
it answers the three methods the notebook's ACP client sends and streams a
couple of `session/update` notifications for a prompt:

    initialize    -> {"protocolVersion": 1, "agentCapabilities": {}}
    session/new   -> {"sessionId": "<id>"}
    session/prompt-> two agent_message_chunk updates, then
                     {"stopReason": "end_turn"}

It imports no third-party modules on purpose: the notebook backend is the ACP
*client*, so the stub only has to be wire-compatible, and it must run under the
same interpreter as the tests without extra dependencies.

Behaviour is switched by argv (`--mode`) or the ACP_STUB_MODE environment
variable so one fixture covers every failure path the backend must contain:

    normal    two fixed chunks ("Hello", " world"), then end_turn
    echo      first chunk is the exact flattened prompt the client sent
    hang      never answer session/prompt; keep draining stdin until EOF
    crash     exit(3) immediately, before reading anything
    mismatch  answer initialize with protocolVersion 2 (client requires 1)
    junk      print a non-JSON line before the first valid response
    eof       answer the prompt normally, then stay alive forever, ignoring
              stdin EOF and SIGTERM (only SIGKILL reaps it). Regression cover
              for the orphaned-child bug: the backend must run its kill ladder
              to completion before it reports the turn done.
    perm      call session/request_permission (one allow_once option) before
              answering, and echo the client's decision back in a chunk
    cap       call fs/read_text_file and terminal/create (neither capability is
              advertised by the client) and echo the refusal error codes back
    trace     emit one tool_call update (the activity the backend translates
              to a trace frame) before streaming the normal chunks

`--pidfile PATH` records the stub's own PID so a test can assert the backend
reaped the child process. `--session-id ID` overrides the session id.

Usage (from the tests):
    sys.executable stub_acp_agent.py --mode normal --pidfile <tmp>
"""

import argparse
import json
import os
import signal
import sys
import time

# Protocol constants this stub speaks. Kept as names so the wire contract is
# readable and a spec bump is a one-line change.
STUB_PROTOCOL_VERSION = 1
MISMATCH_PROTOCOL_VERSION = 2
EXIT_CRASH = 3
DEFAULT_SESSION_ID = "stub-session-1"

# The two chunks streamed by `normal`. The second carries a leading space so a
# test can prove the two deltas concatenate to "Hello world".
NORMAL_CHUNKS = ("Hello", " world")
ECHO_SUFFIX = " [echoed]"

MODE_NORMAL = "normal"
MODE_ECHO = "echo"
MODE_HANG = "hang"
MODE_CRASH = "crash"
MODE_MISMATCH = "mismatch"
MODE_JUNK = "junk"
MODE_EOF = "eof"
MODE_PERM = "perm"
MODE_CAP = "cap"
MODE_TRACE = "trace"

# Correlated JSON-RPC ids for the agent->client requests the stub makes. Fixed
# so the read loop can recognise the matching response; the client only ever
# has one such request outstanding at a time.
PERM_REQUEST_ID = 1000
CAP_FS_REQUEST_ID = 1001
CAP_TERM_REQUEST_ID = 1002
CAP_ELIC_REQUEST_ID = 1003
# In eof mode the stub sleeps this long; only SIGKILL ends it.
EOF_SLEEP_SECONDS = 3600
# Permission option the stub offers; the client's auto-allow picks it.
ALLOW_ONCE_ID = "allow-1"
# `trace` mode: one started tool call whose title the backend turns into a
# trace frame. Distinctive so a test can assert the exact string round-trips.
TRACE_TITLE = "Running a shell command"
TRACE_TOOL_CALL_ID = "tc-trace-1"


def _send(payload):
    """Write one JSON-RPC frame as a newline-terminated line."""
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _reply(request_id, result):
    _send({"jsonrpc": "2.0", "id": request_id, "result": result})


def _notify(method, params):
    _send({"jsonrpc": "2.0", "method": method, "params": params})


def _prompt_text(params):
    """Concatenate the text blocks of a session/prompt params object."""
    blocks = params.get("prompt") or []
    parts = []
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text") or "")
    return "".join(parts)


def _stream_chunk(session_id, text):
    _notify("session/update", {
        "sessionId": session_id,
        "update": {
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": text},
        },
    })


def _stream_tool_call(session_id, title, tool_call_id):
    """Emit a ToolCallStart update (sessionUpdate == "tool_call")."""
    _notify("session/update", {
        "sessionId": session_id,
        "update": {
            "sessionUpdate": "tool_call",
            "toolCallId": tool_call_id,
            "title": title,
            "kind": "execute",
            "status": "in_progress",
        },
    })


def _drain_until_eof():
    """Block reading stdin, ignoring input, until the pipe reaches EOF."""
    while True:
        line = sys.stdin.readline()
        if not line:
            return


def _request(method, params, request_id):
    """Send an agent->client request (the roles are reversed from the calls
    the client makes to us)."""
    _send({"jsonrpc": "2.0", "id": request_id, "method": method,
           "params": params})


def _read_response(request_id):
    """Read stdin until the response to `request_id` arrives; return it.

    Notifications and unrelated messages are skipped, so a stray
    `session/cancel` in flight does not confuse the correlation.
    """
    while True:
        line = sys.stdin.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        if message.get("id") == request_id and "method" not in message:
            return message


def _ignore_signals():
    """Ignore the polite signals the SDK teardown sends before SIGKILL."""
    for sig in (signal.SIGTERM, signal.SIGHUP):
        try:
            signal.signal(sig, signal.SIG_IGN)
        except (ValueError, OSError):
            pass


def _sleep_forever():
    """Never exit, so only SIGKILL can end the process."""
    while True:
        time.sleep(EOF_SLEEP_SECONDS)


def _handle_perm(args, request_id):
    """Ask the client for permission, echo its decision, finish the turn."""
    _request("session/request_permission", {
        "sessionId": args.session_id,
        "toolCall": {"toolCallId": "tc-1", "title": "read a file",
                     "kind": "read"},
        "options": [
            {"optionId": ALLOW_ONCE_ID, "name": "Allow once",
             "kind": "allow_once"},
        ],
    }, PERM_REQUEST_ID)
    response = _read_response(PERM_REQUEST_ID) or {}
    outcome = (response.get("result") or {}).get("outcome") or {}
    _stream_chunk(args.session_id, "[perm outcome=%s option=%s]" % (
        outcome.get("outcome"), outcome.get("optionId")))
    _reply(request_id, {"stopReason": "end_turn"})


def _handle_cap(args, request_id):
    """Exercise three client-bound calls the client advertises no capability
    for; echo whether each came back as a JSON-RPC error, and finish."""
    _request("fs/read_text_file",
             {"sessionId": args.session_id, "path": "/etc/hostname"},
             CAP_FS_REQUEST_ID)
    fs_error = (_read_response(CAP_FS_REQUEST_ID) or {}).get("error") or {}
    _request("terminal/create",
             {"sessionId": args.session_id, "command": "echo hi"},
             CAP_TERM_REQUEST_ID)
    term_error = (_read_response(CAP_TERM_REQUEST_ID) or {}).get("error") or {}
    # elicitation/create is unstable in the SDK and gated off by default, so
    # the refusal may come from the route gate rather than the client override;
    # either way it must be a clean method-not-found, never a hang.
    _request("elicitation/create", {
        "sessionId": args.session_id, "message": "Need input",
        "mode": "url", "elicitationId": "elic-1",
        "url": "https://example.com/"}, CAP_ELIC_REQUEST_ID)
    elic_error = (_read_response(CAP_ELIC_REQUEST_ID) or {}).get("error") or {}
    _stream_chunk(args.session_id, "[cap fs=%s/%s term=%s/%s elic=%s/%s]" % (
        "error" if fs_error else "result", fs_error.get("code"),
        "error" if term_error else "result", term_error.get("code"),
        "error" if elic_error else "result", elic_error.get("code")))
    _reply(request_id, {"stopReason": "end_turn"})


def _handle_prompt(args, request_id, params, mode):
    if mode == MODE_HANG:
        # Deliberately never answer: the client must time the turn out and
        # reap us. Draining stdin means a stdin-EOF teardown ends us quickly.
        _drain_until_eof()
        return
    if mode == MODE_PERM:
        _handle_perm(args, request_id)
        return
    if mode == MODE_CAP:
        _handle_cap(args, request_id)
        return
    if mode == MODE_TRACE:
        _stream_tool_call(args.session_id, TRACE_TITLE, TRACE_TOOL_CALL_ID)
        for chunk in NORMAL_CHUNKS:
            _stream_chunk(args.session_id, chunk)
        _reply(request_id, {"stopReason": "end_turn"})
        return
    if mode == MODE_ECHO:
        chunks = (_prompt_text(params), ECHO_SUFFIX)
    else:
        chunks = NORMAL_CHUNKS
    for chunk in chunks:
        _stream_chunk(args.session_id, chunk)
    _reply(request_id, {"stopReason": "end_turn"})
    if mode == MODE_EOF:
        _sleep_forever()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode",
                        default=os.environ.get("ACP_STUB_MODE", MODE_NORMAL))
    parser.add_argument("--pidfile", default="")
    parser.add_argument("--session-id", default=DEFAULT_SESSION_ID)
    args = parser.parse_args()
    mode = args.mode

    if args.pidfile:
        with open(args.pidfile, "w", encoding="utf-8") as f:
            f.write(str(os.getpid()))

    if mode == MODE_CRASH:
        sys.exit(EXIT_CRASH)

    if mode == MODE_EOF:
        # Install the signal ignores at startup so no teardown signal can race
        # ahead of them; only SIGKILL (or process kill) ends this mode.
        _ignore_signals()

    if mode == MODE_JUNK:
        # A malformed line the client's NDJSON reader must skip, not choke on.
        sys.stdout.write("this is not a json-rpc frame\n")
        sys.stdout.flush()

    version = (MISMATCH_PROTOCOL_VERSION if mode == MODE_MISMATCH
               else STUB_PROTOCOL_VERSION)

    while True:
        line = sys.stdin.readline()
        if not line:
            return
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        method = message.get("method")
        request_id = message.get("id")
        params = message.get("params") or {}

        if method == "initialize":
            _reply(request_id, {
                "protocolVersion": version,
                "agentCapabilities": {"loadSession": False},
            })
        elif method == "session/new":
            _reply(request_id, {"sessionId": args.session_id})
        elif method == "session/prompt":
            _handle_prompt(args, request_id, params, mode)
        # Any other request/notification (session/cancel, ...) is ignored.


if __name__ == "__main__":
    main()
