#!/usr/bin/env python3
"""Real end-to-end check of the ACP provider against the live `opencode acp`.

Not part of the unit suite: it spawns the real agent, which takes time and may
spend model credit. Named without a `test_` prefix and living in tests/manual/
so `unittest discover -s tests` never collects it. Run it by hand:

    .venv_nixlab/bin/python tests/manual/acp_real_opencode_check.py

It exercises both halves the same way the server does:

  1. POST /api/ai/chat through the real Flask test client against a temp
     config dir containing a copy of config/acp.json (no auth.json, so the
     route is open). Consume the SSE stream.
  2. acp_client.run_turn("opencode", ["acp"], ...) directly.

Both turns run with a temp notebook dir as cwd. A watcher thread records every
`opencode` PID that appears while a turn runs, and the check asserts each one
is gone once the turn reports terminal, i.e. no orphan survives.

A missing `opencode`, an unauthenticated agent, or an upstream error is
reported as-is (the exact SSE error frame / event), not treated as a failure
of the notebook code.
"""

import json
import os
import shutil
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

PROMPT = "Reply with exactly: pong"
TURN_TIMEOUT = 180          # generous but bounded
AGENT = "opencode"
AGENT_ARGS = ["acp"]
SERVER = "opencode"


def _opencode_pids():
    """PIDs whose command line mentions opencode (best-effort /proc scan)."""
    found = set()
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open("/proc/%s/cmdline" % entry, "rb") as f:
                cmdline = f.read()
        except OSError:
            continue
        if b"opencode" in cmdline:
            found.add(int(entry))
    return found


class PidWatcher:
    """Record opencode PIDs that appear while a turn runs."""

    def __init__(self):
        self.before = _opencode_pids()
        self.seen = set()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def _loop(self):
        while not self._stop.is_set():
            self.seen |= (_opencode_pids() - self.before)
            self._stop.wait(0.05)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._thread.join(timeout=2)
        self.seen |= (_opencode_pids() - self.before)

    def survivors(self):
        return sorted(pid for pid in self.seen if os.path.exists("/proc/%d" % pid))


def _build_temp_envs():
    """Temp data + config dirs with a copied acp.json and no auth.json."""
    base = tempfile.mkdtemp(prefix="acpreal_")
    data_dir = os.path.join(base, "notebook")
    config_dir = os.path.join(base, "config")
    os.makedirs(data_dir)
    os.makedirs(config_dir)
    live = os.path.join(ROOT, "config", "acp.json")
    cfg = json.load(open(live, encoding="utf-8"))
    cfg.update({"name": SERVER, "cwd": data_dir, "timeout": TURN_TIMEOUT})
    if not cfg.get("agent"):
        # Escape-hatch form: pin the command/args the script wants to run. The
        # key form (the live config's shape) is preserved as-is so the real
        # check exercises the ACP_KNOWN_AGENTS resolution path.
        cfg.pop("agent", None)
        cfg["command"] = AGENT
        cfg["args"] = AGENT_ARGS
    with open(os.path.join(config_dir, "acp.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f)
    # No auth.json -> every /api route is open.
    return base, data_dir, config_dir


def _parse_sse(body):
    """Split an SSE body into (delta_texts, trace_texts, error_frames, done)."""
    deltas, traces, errors, saw_done = [], [], [], False
    for block in body.replace("\r\n", "\n").split("\n\n"):
        lines = block.split("\n")
        event = next((l[6:].strip() for l in lines
                      if l.startswith("event:")), "message")
        data = next((l[5:].strip() for l in lines
                     if l.startswith("data:")), None)
        if data is None:
            continue
        if data == "[DONE]":
            saw_done = True
            continue
        if event == "error":
            errors.append(data)
            continue
        try:
            frame = json.loads(data)
        except ValueError:
            continue
        if frame.get("acp") == "trace":
            traces.append(frame.get("text", ""))
            continue
        content = (frame.get("choices") or [{}])[0].get("delta", {}).get("content")
        if content:
            deltas.append(content)
    return deltas, traces, errors, saw_done


def run_flask_path():
    base, data_dir, config_dir = _build_temp_envs()
    os.environ["NOTEBOOK_DATA_DIR"] = data_dir
    os.environ["NOTEBOOK_CONFIG_DIR"] = config_dir
    import app as nb   # noqa: E402  (env set first: resolves DATA/CONFIG at import)

    print("== Flask test_client path ==")
    print("config/acp.json =", json.load(open(nb.ACP_FILE, encoding="utf-8")))
    # The script writes no auth.json. app.py's import-time ensure_auth_secret()
    # still creates a secret-only one (Flask session key), so the meaningful
    # assertion is that auth is DISABLED: no admin password hash.
    print("auth enabled =", nb.auth_enabled())
    client = nb.app.test_client()
    start = time.time()
    with PidWatcher() as watch:
        r = client.post("/api/ai/chat", json={
            "server": SERVER, "messages": [{"role": "user", "content": PROMPT}]})
        body = r.get_data(as_text=True)
    elapsed = time.time() - start
    deltas, traces, errors, saw_done = _parse_sse(body)
    print("status =", r.status_code, "content_type =", r.content_type)
    print("elapsed = %.1fs" % elapsed)
    print("delta texts =", deltas)
    print("trace frames =", traces)
    print("error frames =", errors)
    print("saw [DONE] =", saw_done)
    survivors = watch.survivors()
    print("opencode PIDs seen =", sorted(watch.seen), "survivors =", survivors)
    for pid in survivors:
        try:
            os.kill(pid, 9)
        except OSError:
            pass
    ok = (r.status_code == 200 and deltas and saw_done and not errors
          and not survivors)
    print("Flask path result =", "PASS" if ok else "FAIL")
    return ok, elapsed


def run_direct_turn():
    import acp_client
    base, data_dir, _ = _build_temp_envs()
    print("\n== direct acp_client.run_turn path ==")
    start = time.time()
    with PidWatcher() as watch:
        events = list(acp_client.run_turn(
            AGENT, AGENT_ARGS, cwd=data_dir, prompt=PROMPT,
            timeout=TURN_TIMEOUT, keepalive=False))
    elapsed = time.time() - start
    print("elapsed = %.1fs" % elapsed)
    print("events =", events)
    stop = [e.get("stopReason") for e in events if e.get("type") == "done"]
    print("stopReason =", stop[0] if stop else None)
    survivors = watch.survivors()
    print("opencode PIDs seen =", sorted(watch.seen), "survivors =", survivors)
    for pid in survivors:
        try:
            os.kill(pid, 9)
        except OSError:
            pass
    text = "".join(e.get("text", "") for e in events if e.get("type") == "text")
    ok = bool(text) and bool(stop) and not survivors
    print("direct path result =", "PASS" if ok else "FAIL")
    return ok, elapsed


def main():
    if shutil.which(AGENT) is None:
        print("opencode not found on PATH; skipping real check")
        return 0
    fok, fdt = run_flask_path()
    dok, ddt = run_direct_turn()
    print("\nTOTAL wall clock = %.1fs" % (fdt + ddt))
    print("RESULT:", "PASS" if (fok and dok) else "FAIL")
    return 0 if (fok and dok) else 1


if __name__ == "__main__":
    sys.exit(main())
