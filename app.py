"""Markdown notebook server.

A small, single-user Flask app that serves a Markdown notebook over the web.
Backend (this file) is JSON-only; the frontend lives under templates/ + static/
and renders Markdown client-side. Notebook data lives in data/, user config in
config/ -- two separate folders by design.
"""

import argparse
import dataclasses
import fnmatch
import json
import os
import re
import secrets
import shutil
import socket
import time
import urllib.error
import urllib.request

import bcrypt
from flask import Flask, Response, jsonify, render_template, request, session

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# NOTEBOOK_DATA_DIR / NOTEBOOK_CONFIG_DIR let tests (and alternate installs)
# point the data and config folders elsewhere. Default to the project folders.
DATA_DIR = os.environ.get("NOTEBOOK_DATA_DIR") or os.path.join(BASE_DIR, "notebook")

CONFIG_DIR = os.environ.get("NOTEBOOK_CONFIG_DIR") or os.path.join(BASE_DIR, "config")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
# Auth lives in its own file so the UI-prefs blob (POSTed by any client) can
# never accidentally include hashed credentials. Schema:
#   {"secret": "<hex>", "admin_password_hash": "<bcrypt>", "viewer_password_hash": "<bcrypt>",
#    "tokens": [{"name": "...", "role": "admin"|"viewer", "id": "<10 hex>",
#                "hash": "<bcrypt of full token string>", "created": <unix ts>}]}
# Either password hash may be empty/missing to leave that role disabled. If
# both are unset the whole auth layer is bypassed (and tokens are cleared --
# they would be meaningless while every route is open).
AUTH_FILE = os.path.join(CONFIG_DIR, "auth.json")
# On first run, if DATA_DIR doesn't exist, the contents of this folder are
# copied into it. Ship a tiny starter notebook under notebook.template/ so
# new users see something useful on first launch.
TEMPLATE_DIR = os.path.join(BASE_DIR, "notebook.template")
# The agent guide lives at the project root as plain Markdown (easy to
# read and maintain) and is served verbatim at /agent.md with the current
# auth state substituted into a placeholder.
AGENT_GUIDE_FILE = os.path.join(BASE_DIR, "agent.md")

# Search caps so payloads stay sane. The defaults protect browser
# clients; agents may raise them per-request via ?limit= / ?perFile=
# up to these hard ceilings so big notebooks stay searchable without
# an unbounded scan.
MAX_TOTAL_MATCHES = 200
MAX_MATCHES_PER_FILE = 20
MAX_TOTAL_MATCHES_CEILING = 2000
MAX_MATCHES_PER_FILE_CEILING = 200
SNIPPET_PAD = 60  # chars of context each side of a match

app = Flask(__name__)

# Paths whose responses must never be cached by the browser or any
# intermediary. These are the gated read endpoints (tree, file, search,
# config GET, info) -- caching them would let a previously-authorized
# client re-display the content after the auth state tightens (e.g. the
# admin enables the viewer password), which is exactly the leak the
# user reported. `no-store` makes the response treat the cache as
# forbidden; `private` prevents shared caches from holding it.
_GATED_READ_PATHS = (
    "/api/tree", "/api/ls", "/api/file", "/api/search", "/api/config", "/api/info",
)

@app.after_request
def _no_store_gated_reads(resp):
    """Send Cache-Control: no-store on gated read responses so a
    previously-authorized browser can't keep showing the content
    after the auth state tightens (e.g. admin enables the viewer
    password). Without this, a cached GET would re-render the
    notebook on the next navigation even though the server would
    have returned 401. This is belt-and-suspenders on top of the
    request-time auth check: the request still 401s, and the cache
    is also told to drop the response. """
    if request.path in _GATED_READ_PATHS:
        resp.headers["Cache-Control"] = "no-store, private"
    return resp


# --------------------------------------------------------------------------- #
# Startup seeding
# --------------------------------------------------------------------------- #
def seed(verbose=False):
    """Ensure notebook/ and config/ exist with sensible defaults on first run.

    Order matters:
    1. Make sure config/ exists with an empty config.json (cheap, no migration).
    2. If we're using the project-default data folder and the legacy
       `data/` directory is present but `notebook/` is not, move `data/`
       to `notebook/` so existing user notes aren't lost. Then drop the
       now-empty `data/` directory if possible.
    3. If `notebook/` still doesn't exist (fresh install or just-migrated),
       copy the contents of `notebook.template/` into it. This is a
       copy, not a symlink, so editing notes never touches the template.

    The migration only runs when DATA_DIR is the project-default path.
    When the user has set NOTEBOOK_DATA_DIR they are pointing at a folder
    of their own choosing and we leave it alone.

    Returns a list of human-readable status lines (empty if nothing notable
    happened). The `__main__` block prints these for the user; tests pass
    ``verbose=False`` to keep test output clean.
    """
    notes = []
    os.makedirs(CONFIG_DIR, exist_ok=True)
    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump({}, f)

    legacy_data = os.path.join(BASE_DIR, "data")
    using_default = (DATA_DIR == os.path.join(BASE_DIR, "notebook"))
    if using_default and os.path.isdir(legacy_data) and not os.path.isdir(DATA_DIR):
        shutil.move(legacy_data, DATA_DIR)
        notes.append("Migrated data/ -> notebook/ (one-time)")
        # Drop the empty source dir if possible; if anything was left
        # behind (e.g. a stray file), leave it -- .gitignore covers it.
        try:
            if os.path.isdir(legacy_data) and not os.listdir(legacy_data):
                os.rmdir(legacy_data)
        except OSError:
            pass

    if not os.path.isdir(DATA_DIR):
        # copytree creates the destination; don't pre-create it or
        # copytree will raise FileExistsError.
        if os.path.isdir(TEMPLATE_DIR):
            shutil.copytree(TEMPLATE_DIR, DATA_DIR)
            notes.append("Created notebook/ from notebook.template/")
        else:
            os.makedirs(DATA_DIR)
        # If the template folder is missing, the empty notebook/ is fine --
        # the user can create files from the UI.
    return notes


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def safe_path(rel_path):
    """Resolve a user-supplied relative path against DATA_DIR safely.

    Returns the real absolute path if it stays within DATA_DIR, else None.
    Blocks `..` traversal and absolute input. Interior symlinks that point
    outside the resolved DATA_DIR are allowed (the user created them
    intentionally via the filesystem).
    """
    if not rel_path or not isinstance(rel_path, str):
        return None
    rel = rel_path.strip()
    if not rel:
        return None
    # Reject absolute input outright (/etc/passwd, C:\...) rather than
    # normalising it into a path inside DATA_DIR.
    if os.path.isabs(rel):
        return None
    candidate = os.path.normpath(os.path.join(DATA_DIR, rel))
    # Boundary check against the unresolved DATA_DIR so that interior
    # symlinks (e.g. notebook/projects -> /some/other/folder) are not
    # blocked — the normalized path still starts with DATA_DIR before
    # symlink resolution.
    norm_data = os.path.normpath(DATA_DIR)
    if candidate == norm_data or candidate.startswith(norm_data + os.sep):
        return os.path.realpath(candidate)
    return None


def err(message, status=400):
    return jsonify({"error": message}), status


def expect_json(*required_keys):
    """Validate the request body is a JSON object with the required keys.

    Returns (data, None) on success or (None, error_response).
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None, err("Expected a JSON object body", 400)
    for key in required_keys:
        if key not in data:
            return None, err("Missing required field: %s" % key, 400)
    return data, None


def rel_from(abs_path):
    """Render an absolute path inside DATA_DIR as a forward-slash relative path."""
    rel = os.path.relpath(abs_path, DATA_DIR)
    return rel.replace(os.sep, "/")


def atomic_write(path, content):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)


def build_tree(path):
    """Recursively build a dirs-first, files-second tree of .md files.

    Skips dotfiles and __pycache__.
    """
    entries = []
    try:
        names = sorted(os.listdir(path))
    except OSError:
        return entries
    for name in names:
        if name.startswith(".") or name == "__pycache__":
            continue
        full = os.path.join(path, name)
        rel = rel_from(full)
        if os.path.isdir(full):
            entries.append({
                "name": name,
                "type": "dir",
                "path": rel,
                "children": build_tree(full),
            })
        elif os.path.isfile(full) and name.lower().endswith(".md"):
            entries.append({"name": name, "type": "file", "path": rel})
    entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
    return entries


def _remove_path(path):
    """Delete a file, symlink, or directory tree. Raises OSError."""
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    else:
        os.remove(path)


# --------------------------------------------------------------------------- #
# Patch engine for POST /api/edit
# --------------------------------------------------------------------------- #
# Edits are applied to an in-memory buffer in order; any failed op aborts
# the whole batch before anything is written, so a patch is all-or-nothing.
class _EditError(ValueError):
    """A patch batch failed validation or application.

    Raised before any disk write happens so a failed batch leaves the
    file untouched (all-or-nothing semantics)."""


def _edit_field(edit, index, key):
    """Fetch a required string field from an edit op, with a precise error."""
    if key not in edit:
        raise _EditError("edit %d: missing required field '%s'" % (index, key))
    val = edit[key]
    if not isinstance(val, str):
        raise _EditError("edit %d: '%s' must be a string" % (index, key))
    return val


def _edit_int(edit, index, key, default=None, lo=None, hi=None):
    """Fetch an optional integer field with bounds; default is required."""
    if key not in edit or edit[key] is None:
        if default is None:
            raise _EditError("edit %d: missing required field '%s'" % (index, key))
        return default
    val = edit[key]
    if isinstance(val, bool) or not isinstance(val, int):
        raise _EditError("edit %d: '%s' must be an integer" % (index, key))
    if ((lo is not None and val < lo) or (hi is not None and val > hi)):
        bounds = []
        if lo is not None:
            bounds.append(">=%d" % lo)
        if hi is not None:
            bounds.append("<=%d" % hi)
        raise _EditError("edit %d: '%s' out of range (%s)"
                         % (index, key, ", ".join(bounds)))
    return val


def _text_to_lines(text):
    """Split patch text into newline-terminated full lines."""
    parts = text.split("\n")
    if parts and parts[-1] == "":
        parts.pop()
    return [part + "\n" for part in parts]


def _as_lines(text):
    """Normalise the working buffer into newline-terminated lines.

    A file whose last line has no trailing newline gets one added; this
    keeps inserted/replaced lines from gluing onto the final fragment.
    Line ops therefore guarantee the patched file ends with a newline.
    """
    lines = text.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    return lines


def _edit_line_range(edit, index, line_count):
    """Validate {start[, end]} 1-based inclusive against len(lines)."""
    start = _edit_int(edit, index, "start", lo=1, hi=line_count)
    end = _edit_int(edit, index, "end", default=start, lo=start, hi=line_count)
    return start, end


def _edit_insert_pos(edit, index, line_count):
    """Validate exactly one of {after_line, before_line}; returns a slice pos."""
    has_after = edit.get("after_line") is not None
    has_before = edit.get("before_line") is not None
    if has_after == has_before:
        raise _EditError(
            "edit %d: give exactly one of 'after_line' or 'before_line'" % index)
    if has_after:
        # Inserting after line N lands at slice position N (0 == top).
        return _edit_int(edit, index, "after_line", lo=0, hi=line_count)
    pos = _edit_int(edit, index, "before_line", lo=1, hi=line_count + 1)
    return pos - 1


def _edit_find_replace(text, edit, index):
    """One find_replace op. Literal by default; regex opts into re.subn
    semantics (so backreference escapes like \\1 work in replace_with)."""
    find = _edit_field(edit, index, "find")
    replace_with = _edit_field(edit, index, "replace_with")
    count = edit.get("count")
    if count is not None and (
            isinstance(count, bool) or not isinstance(count, int) or count < 0):
        raise _EditError("edit %d: 'count' must be a non-negative integer" % index)
    optional = bool(edit.get("optional", False))
    if edit.get("regex"):
        flags = re.IGNORECASE if edit.get("ignore_case") else 0
        try:
            pattern = re.compile(find, flags)
        except re.error as exc:
            raise _EditError("edit %d: invalid regex: %s" % (index, exc))
        new_text, hits = pattern.subn(replace_with, text, count=count or 0)
    else:
        if not find:
            raise _EditError("edit %d: 'find' must be a non-empty string" % index)
        occurrences = text.count(find)
        hits = occurrences if count in (None, 0) else min(count, occurrences)
        new_text = text.replace(find, replace_with,
                                count if count else -1)
    if hits == 0 and not optional:
        raise _EditError(
            "edit %d: no match for %s%r; pass \"optional\": true to allow a no-op"
            % (index, "regex " if edit.get("regex") else "", find))
    return new_text


def _apply_edits(text, edits):
    """Apply an ordered batch of patch ops to `text`, all in memory.

    Ops: append / prepend / find_replace / line_insert / line_replace /
    line_delete. Raises _EditError on the first problem -- callers must
    not touch the file when that happens, keeping batches atomic.
    """
    for index, edit in enumerate(edits, 1):
        if not isinstance(edit, dict):
            raise _EditError("edit %d: must be a JSON object" % index)
        op = edit.get("op")
        if op == "append":
            text += _edit_field(edit, index, "text")
        elif op == "prepend":
            text = _edit_field(edit, index, "text") + text
        elif op == "find_replace":
            text = _edit_find_replace(text, edit, index)
        elif op == "line_insert":
            lines = _as_lines(text)
            pos = _edit_insert_pos(edit, index, len(lines))
            lines[pos:pos] = _text_to_lines(_edit_field(edit, index, "text"))
            text = "".join(lines)
        elif op == "line_replace":
            lines = _as_lines(text)
            start, end = _edit_line_range(edit, index, len(lines))
            lines[start - 1:end] = _text_to_lines(_edit_field(edit, index, "text"))
            text = "".join(lines)
        elif op == "line_delete":
            lines = _as_lines(text)
            start, end = _edit_line_range(edit, index, len(lines))
            del lines[start - 1:end]
            text = "".join(lines)
        else:
            raise _EditError("edit %d: unknown op %r" % (index, op))
    return text


# --------------------------------------------------------------------------- #
# Auth (two-password gate: admin = r/w, viewer = r/o)
# --------------------------------------------------------------------------- #
def load_auth():
    """Return the parsed auth.json contents, or an empty dict if missing."""
    if not os.path.isfile(AUTH_FILE):
        return {}
    try:
        with open(AUTH_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_auth(data):
    """Persist the auth dict atomically (same pattern as config.json)."""
    with open(AUTH_FILE + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(AUTH_FILE + ".tmp", AUTH_FILE)


def ensure_auth_secret():
    """Make sure auth.json exists with at least a 32-byte hex secret.

    The secret is used as Flask's session-signing key, so it's generated once
    and persisted. Returns the loaded auth dict.
    """
    data = load_auth()
    if "secret" not in data or not data["secret"]:
        data["secret"] = secrets.token_hex(32)
        save_auth(data)
    return data


def auth_enabled():
    """True if the admin password hash is set. The auth layer is "on"
    iff the admin password exists; the viewer password is now only a
    secondary login option (it lets the admin hand out a read-only
    password without exposing the admin one). Both reads and writes
    are gated when this is true -- the server must not hand any
    notebook data to a client that hasn't logged in."""
    data = load_auth()
    return bool(data.get("admin_password_hash"))


def has_viewer_password():
    """True if the viewer password hash is set (regardless of admin)."""
    return bool(load_auth().get("viewer_password_hash"))


def _check_password(plain, stored_hash):
    """Constant-time-ish bcrypt check. Returns False for any error so a
    bad hash on disk can't crash login."""
    if not stored_hash or not isinstance(stored_hash, str):
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), stored_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# --------------------------------------------------------------------------- #
# API tokens (named bearer credentials for agents / scripts)
# --------------------------------------------------------------------------- #
# Tokens let non-browser clients call the API with a static credential
# instead of doing the cookie login dance. Each token maps onto the existing
# roles: "admin" == full access, "viewer" == reads only. Storage lives in
# auth.json under "tokens"; only a bcrypt hash is kept, and the full token
# string is shown exactly once (in the create response).
#
# Token format: nbtk_<40 hex>. The first 10 hex chars are a public lookup id
# so the server finds the single right hash without bcrypt-checking every
# stored token; the remaining 30 chars are the secret. The id alone never
# authenticates anything -- the stored hash covers the whole token string.
_TOKEN_PREFIX = "nbtk_"
_TOKEN_ID_LEN = 10
_TOKEN_SECRET_LEN = 30
_TOKEN_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _generate_token_string():
    """Return a fresh full token string (nbtk_ + 40 hex chars)."""
    raw = secrets.token_hex((_TOKEN_ID_LEN + _TOKEN_SECRET_LEN) // 2)
    return _TOKEN_PREFIX + raw


def _token_id(token):
    """Extract the public lookup id portion of a full token string."""
    return token[len(_TOKEN_PREFIX):][:10]


def _find_token(presented):
    """Look up a presented token string among the tokens in auth.json.

    Returns the matching stored dict ({name, role, ...}) or None. Cheap
    prefix/charset/length rejection happens before any bcrypt work; a wrong
    secret then fails the bcrypt check against the one candidate selected
    by id, so cost stays O(1) bcrypt per request regardless of token count.
    """
    if not isinstance(presented, str) or not presented.startswith(_TOKEN_PREFIX):
        return None
    raw = presented[len(_TOKEN_PREFIX):].lower()
    if len(raw) != _TOKEN_ID_LEN + _TOKEN_SECRET_LEN:
        return None
    if any(c not in "0123456789abcdef" for c in raw):
        return None
    for tok in load_auth().get("tokens") or []:
        if isinstance(tok, dict) and tok.get("id") == raw[:_TOKEN_ID_LEN]:
            if _check_password(presented, tok.get("hash")):
                return tok
            return None
    return None


def _public_token(tok):
    """Strip secrets from a stored token dict for API responses."""
    out = {"name": tok.get("name"), "role": tok.get("role")}
    if tok.get("created"):
        out["created"] = tok["created"]
    return out


def _request_role():
    """Resolve the caller's role for a gated route (precondition: auth on).

    Returns (role, error_response); exactly one is None.

    A Bearer token, when presented, is authoritative: a malformed or unknown
    token fails the request outright instead of silently downgrading to
    whatever the cookie session says -- machine clients must get a
    deterministic answer for the credential they sent. Invalid bearer
    attempts share the login rate limiter. Without a Bearer header the
    signed session cookie decides, as before.
    """
    header = request.headers.get("Authorization") or ""
    if header.startswith("Bearer "):
        presented = header[len("Bearer "):].strip()
        ip = request.remote_addr or "unknown"
        if _login_locked_out(ip):
            return None, err("Too many failed attempts; try again in a minute", 429)
        tok = _find_token(presented)
        if tok is not None:
            _clear_login_failures(ip)
            return tok.get("role"), None
        _record_login_failure(ip)
        return None, err("Invalid API token", 401)
    role = session.get("role")
    if not role:
        return None, err("Unauthorized", 401)
    return role, None


# In-memory rate limiter: {ip: [timestamp, ...]} of recent failed logins.
# Best-effort -- an attacker can spoof headers, but it slows trivial brute
# force on the LAN. Resets on successful login.
_LOGIN_FAIL_WINDOW = 60   # seconds
_LOGIN_FAIL_LIMIT = 5
_login_failures = {}


def _record_login_failure(ip):
    """Drop timestamps older than the window, append the new one."""
    now = time.time()
    cutoff = now - _LOGIN_FAIL_WINDOW
    history = [t for t in _login_failures.get(ip, []) if t >= cutoff]
    history.append(now)
    _login_failures[ip] = history


def _login_locked_out(ip):
    now = time.time()
    cutoff = now - _LOGIN_FAIL_WINDOW
    history = [t for t in _login_failures.get(ip, []) if t >= cutoff]
    _login_failures[ip] = history
    return len(history) >= _LOGIN_FAIL_LIMIT


def _clear_login_failures(ip):
    _login_failures.pop(ip, None)


def login_required(view):
    """Require either no auth configured, or a valid session / bearer role."""
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not auth_enabled():
            return view(*args, **kwargs)
        _role, error = _request_role()
        if error:
            return error
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    """Require the resolved role (session or bearer token) to be 'admin'.
    Always require login too."""
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not auth_enabled():
            return view(*args, **kwargs)
        role, error = _request_role()
        if error:
            return error
        if role != "admin":
            return err("Forbidden", 403)
        return view(*args, **kwargs)

    return wrapped


def read_login_required(view):
    """Require either no auth configured, or a session with a role.

    Used for the read-only routes (tree, file GET, config GET, info,
    search). The auth layer being "on" means an admin password is set;
    in that case the server must not hand any notebook data to a
    client that hasn't logged in, regardless of whether a separate
    viewer password is configured. The earlier "admin-only, reads
    open" mode leaked the full file tree + file bodies + search hits
    to anyone who hit the site, with only a CSS blur in front of the
    render. The blur was cosmetic; the data was already on the wire.

    The viewer password is now a secondary login option (you can
    choose to log in as a viewer role with a different password) but
    it is no longer the switch that gates reads. Once the admin
    password is set, every read is gated. A named API token sent as a
    Bearer credential satisfies this gate with its own role, so agents
    can read without ever holding a browser session.
    """
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not auth_enabled():
            return view(*args, **kwargs)
        _role, error = _request_role()
        if error:
            return error
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------- #
# Routes: page + config
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    theme = _read_theme_preference()
    return render_template("index.html", theme=theme)


def _read_theme_preference():
    """Read the user's saved theme from config, defaulting to 'auto'."""
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return cfg.get("theme", "auto")
    except (OSError, ValueError):
        return "auto"


@app.route("/api/config", methods=["GET"])
@read_login_required
def get_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        cfg = {}
    return jsonify(cfg)


@app.route("/api/info", methods=["GET"])
@read_login_required
def info():
    """Read-only info used by the settings page. Returns the absolute
    data/config directories; both are already known to the user (they are
    the folders the server is operating on) and contain no secrets."""
    return jsonify({
        "data_dir": DATA_DIR,
        "config_dir": CONFIG_DIR,
    })


@app.route("/api/config", methods=["POST"])
@admin_required
def set_config():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return err("Expected a JSON object body", 400)
    try:
        with open(CONFIG_FILE + ".tmp", "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(CONFIG_FILE + ".tmp", CONFIG_FILE)
    except OSError as exc:
        return err("Could not write config: %s" % exc, 500)
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- #
# Routes: auth (login / logout / status)
# --------------------------------------------------------------------------- #
@app.route("/api/auth", methods=["GET"])
def auth_status():
    """Public endpoint: tells the client the current auth state without
    exposing any hashes. Always returns 200 so the frontend can decide
    whether to show a login modal without itself being a gated request.

    Shape:
      enabled   -- True if the admin password is set (auth layer is on,
                   and reads + writes both require a session)
      hasAdmin  -- True if the admin password hash is non-empty
      hasViewer -- True if the viewer password hash is non-empty.
                   The viewer password is now a secondary login option
                   only; the admin password is what gates reads. The
                   UI shows this as the state of the "viewer password"
                   section, not as a read-gating toggle.
      role      -- the session role if the user is logged in, else null
    """
    data = load_auth()
    has_admin = bool(data.get("admin_password_hash"))
    has_viewer = bool(data.get("viewer_password_hash"))
    role = session.get("role") if has_admin else None
    return jsonify({
        "enabled": has_admin,
        "hasAdmin": has_admin,
        "hasViewer": has_viewer,
        "role": role,
    })


@app.route("/api/login", methods=["POST"])
def auth_login():
    """Try the supplied password against the admin hash, then the viewer hash.

    Tries admin first so a password that's set as both still resolves to
    admin. Failed attempts are rate-limited per client IP (5 / 60s).
    """
    if not auth_enabled():
        return err("Auth is not enabled", 400)
    data, error = expect_json("password")
    if error:
        return error
    pw = data["password"]
    if not isinstance(pw, str) or not pw:
        return err("password must be a non-empty string", 400)

    ip = request.remote_addr or "unknown"
    if _login_locked_out(ip):
        return err("Too many failed attempts; try again in a minute", 429)

    auth = load_auth()
    role = None
    if _check_password(pw, auth.get("admin_password_hash")):
        role = "admin"
    elif _check_password(pw, auth.get("viewer_password_hash")):
        role = "viewer"

    if role is None:
        _record_login_failure(ip)
        return err("Invalid password", 401)

    _clear_login_failures(ip)
    session["role"] = role
    return jsonify({"role": role})


@app.route("/api/logout", methods=["POST"])
@login_required
def auth_logout():
    session.pop("role", None)
    return jsonify({"ok": True})


# Minimum length we accept for any new password. Bcrypt with cost 12 is
# already slow; a short minimum would just make brute force trivial.
_MIN_PASSWORD_LEN = 6


@app.route("/api/auth/passwords", methods=["POST"])
@admin_required
def auth_set_passwords():
    """Set, change, or clear the admin and/or viewer password.

    Body: {"admin_password": "...", "viewer_password": "...",
    "admin_current_password": "..."}. Either password field may be
    omitted (null).

    Admin password semantics:
      null  -> leave as-is
      ""    -> clear it (disables the auth layer entirely; also clears
               the viewer password since it is meaningless once auth
               is off). Requires `admin_current_password` and verifies
               it against the stored admin hash -- this is a destructive
               operation, so the current password must be re-typed.
      str   -> bcrypt-hash and set. When an admin already exists this
               also requires `admin_current_password` (see below).

    Viewer password semantics:
      null  -> leave as-is
      ""    -> clear the viewer hash
      str   -> bcrypt-hash and set

    Changing the admin password (i.e. an admin already exists and
    `admin_password` is provided as a non-empty value) requires
    `admin_current_password` and verifies it against the stored admin
    hash. This prevents a shoulder-surfing / unattended-tab scenario
    where the admin is already logged in but someone else changes the
    password: the current password must be re-typed to confirm. Setting
    the initial admin password (no admin yet) does not require it.

    Returns the new state ({hasAdmin, hasViewer}) so the client can
    update its UI without a follow-up /api/auth call.
    """
    data, error = expect_json("admin_password", "viewer_password")
    if error:
        return error
    admin_pw = data["admin_password"]
    viewer_pw = data["viewer_password"]
    # admin_current_password is optional; the business logic below
    # requires it only when the admin password is being changed
    # (i.e. an admin already exists and a new non-empty value is
    # provided). Treat an absent key as None.
    admin_current_pw = data.get("admin_current_password")
    # None means "don't touch this field"; string means "set/change";
    # anything else is a type error.
    if not (admin_pw is None or isinstance(admin_pw, str)):
        return err("admin_password must be a string or null", 400)
    if not (viewer_pw is None or isinstance(viewer_pw, str)):
        return err("viewer_password must be a string or null", 400)
    if not (admin_current_pw is None or isinstance(admin_current_pw, str)):
        return err("admin_current_password must be a string or null", 400)

    auth = load_auth()
    # Admin password is permanent once set; you can change it (provide
    # a new value) but not clear it. Semantics of each field:
    #   null  -> don't touch this field
    #   ""    -> clear this field (disables auth for admin; clears the
    #            viewer hash for viewer)
    #   str   -> bcrypt-hash and set
    # Length checks only apply to non-empty values; empty is the
    # "clear" signal.
    if admin_pw not in (None, "") and len(admin_pw) < _MIN_PASSWORD_LEN:
        return err("Admin password must be at least %d characters"
                   % _MIN_PASSWORD_LEN, 400)
    if viewer_pw not in (None, "") and len(viewer_pw) < _MIN_PASSWORD_LEN:
        return err("Viewer password must be at least %d characters"
                   % _MIN_PASSWORD_LEN, 400)

    # Both changing the admin password to a new value AND clearing it
    # (admin_pw == "") require the current password: changing guards
    # against an unattended / shared-machine admin session silently
    # rotating the password, and clearing is destructive (disables the
    # entire auth layer), so it must be confirmed too.
    changing_admin = (
        admin_pw not in (None, "")
        and bool(auth.get("admin_password_hash"))
    )
    clearing_admin = (
        admin_pw == ""
        and bool(auth.get("admin_password_hash"))
    )
    if changing_admin or clearing_admin:
        if not admin_current_pw:
            return err("Current admin password is required to change or clear the admin password", 400)
        if not _check_password(admin_current_pw, auth.get("admin_password_hash")):
            return err("Current admin password is incorrect", 400)

    if admin_pw is None:
        # leave as-is
        pass
    elif admin_pw == "":
        # Clear the admin password (disables the auth layer entirely).
        # Also clear the viewer password and any API tokens since they
        # are meaningless once auth is off -- leaving them would just
        # be stale credentials on disk.
        auth.pop("admin_password_hash", None)
        auth.pop("viewer_password_hash", None)
        auth.pop("tokens", None)
    else:
        auth["admin_password_hash"] = bcrypt.hashpw(
            admin_pw.encode("utf-8"), bcrypt.gensalt(12)
        ).decode()
    if viewer_pw is None:
        pass
    elif viewer_pw == "":
        auth.pop("viewer_password_hash", None)
    else:
        auth["viewer_password_hash"] = bcrypt.hashpw(
            viewer_pw.encode("utf-8"), bcrypt.gensalt(12)
        ).decode()
    save_auth(auth)
    return jsonify({
        "ok": True,
        "hasAdmin": bool(auth.get("admin_password_hash")),
        "hasViewer": bool(auth.get("viewer_password_hash")),
    })


# --------------------------------------------------------------------------- #
# Routes: API tokens (named bearer credentials for agents / scripts)
# --------------------------------------------------------------------------- #
@app.route("/api/auth/tokens", methods=["GET"])
@admin_required
def auth_tokens_list():
    """List the issued tokens (names + roles only -- never the token
    strings or hashes)."""
    tokens = load_auth().get("tokens") or []
    return jsonify({"tokens": [_public_token(t) for t in tokens
                               if isinstance(t, dict)]})


@app.route("/api/auth/tokens", methods=["POST"])
@admin_required
def auth_tokens_create():
    """Issue a named token bound to a role.

    Body: {"name": "opencode", "role": "admin"|"viewer"}. The full token
    string is returned exactly once, in this response only; auth.json keeps
    just the bcrypt hash. Issuing requires the auth layer to be on (an
    admin password set): while auth is off every route is open and a token
    would be meaningless.
    """
    if not auth_enabled():
        return err("Set an admin password before issuing API tokens", 400)
    data, error = expect_json("name", "role")
    if error:
        return error
    name = data["name"]
    role = data["role"]
    if not isinstance(name, str) or not _TOKEN_NAME_RE.match(name):
        return err(
            "name must be 1-64 chars of letters, digits, dot, dash or "
            "underscore (starting with a letter or digit)", 400)
    if role not in ("admin", "viewer"):
        return err("role must be 'admin' or 'viewer'", 400)

    auth = load_auth()
    tokens = [t for t in (auth.get("tokens") or []) if isinstance(t, dict)]
    if any(t.get("name") == name for t in tokens):
        return err("A token with that name already exists", 409)

    token = _generate_token_string()
    entry = {
        "name": name,
        "role": role,
        "id": _token_id(token),
        "hash": bcrypt.hashpw(token.encode("utf-8"),
                              bcrypt.gensalt(12)).decode(),
        "created": int(time.time()),
    }
    tokens.append(entry)
    auth["tokens"] = tokens
    save_auth(auth)

    # The token string is shown exactly once; never stored in the clear.
    return jsonify({
        "ok": True,
        "name": name,
        "role": role,
        "created": entry["created"],
        "token": token,
    })


@app.route("/api/auth/tokens/<name>", methods=["DELETE"])
@admin_required
def auth_tokens_delete(name):
    """Revoke a token by name. The credential stops working immediately."""
    auth = load_auth()
    tokens = auth.get("tokens") or []
    remaining = [t for t in tokens
                 if not (isinstance(t, dict) and t.get("name") == name)]
    if len(remaining) == len(tokens):
        return err("No such token", 404)
    auth["tokens"] = remaining
    save_auth(auth)
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- #
# AI assistant (OpenAI-compatible chat proxy + client-key config)
# --------------------------------------------------------------------------- #
# The browser talks only to this server; this server relays chat to any
# OpenAI-compatible /v1/chat/completions endpoint. The API key lives in
# config/ai.json (never inside config.json -- that blob is POSTable by any
# authed client and would leak it) and never leaves the server: GET
# /api/ai/config masks it to a boolean before responding.
#
# Streaming is relayed verbatim as SSE (text/event-stream), byte by byte,
# so no upstream chunk is ever buffered whole -- a 4096-token answer paints
# progressively just like talking to the provider directly.
AI_FILE = os.path.join(CONFIG_DIR, "ai.json")


@dataclasses.dataclass
class Upstream:
    """One saved OpenAI-compatible endpoint (config/ai.json "servers")."""
    name: str
    base_url: str
    api_key: str = ""
    model: str = ""


def load_ai_config():
    """Read config/ai.json, always returning a well-formed dict.

    Shape: {"default": "name-or-empty",
            "servers": [{"name": str, "base_url": str,
                         "api_key": str, "model": str}, ...]}
    Corrupt or missing files degrade to empty config -- never a crash.
    """
    try:
        with open(AI_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    return data if isinstance(data, dict) else {}


def save_ai_config(data):
    """Persist the AI settings atomically (same temp+replace as auth.json)."""
    with open(AI_FILE + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(AI_FILE + ".tmp", AI_FILE)


def _sanitize_server(raw, index):
    """Validate one server entry from a POST body; returns a clean dict or
    raises ValueError with a precise message."""
    if not isinstance(raw, dict):
        raise ValueError("servers[%d] must be an object" % index)
    name = raw.get("name")
    base_url = raw.get("baseUrl")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("servers[%d].name must be a non-empty string" % index)
    if not isinstance(base_url, str) or not base_url.strip():
        raise ValueError("servers[%d].baseUrl must be a non-empty string" % index)
    name = name.strip()
    if len(name) > 60:
        raise ValueError("servers[%d].name is longer than 60 chars" % index)
    base_url = base_url.strip()
    if not base_url.lower().startswith(("http://", "https://")):
        raise ValueError("servers[%d].baseUrl must be an http(s) URL" % index)
    # Strip a trailing slash AND a trailing /v1 so clients can paste either
    # form (https://api.openai.com or https://api.openai.com/v1); _chat_url
    # appends the canonical path.
    base_url = base_url.rstrip("/")
    if base_url.lower().endswith("/v1"):
        base_url = base_url[:-3]
    if len(base_url) > 300:
        raise ValueError("servers[%d].baseUrl is longer than 300 chars" % index)
    api_key = raw.get("apiKey", "")
    if api_key is None:
        api_key = ""
    if not isinstance(api_key, str):
        raise ValueError("servers[%d].apiKey must be a string" % index)
    # Empty apiKey + replaceSecret means "keep the stored one": lets the
    # settings UI save a profile without re-typing the key every time.
    if api_key == "" and raw.get("replaceSecret"):
        stored = load_ai_config()
        for s in stored.get("servers") or []:
            if isinstance(s, dict) and s.get("name") == name:
                api_key = s.get("api_key") or ""
                break
    if len(api_key) > 500:
        raise ValueError("servers[%d].apiKey is longer than 500 chars" % index)
    model = raw.get("model", "")
    if model is None:
        model = ""
    if not isinstance(model, str):
        raise ValueError("servers[%d].model must be a string" % index)
    return {"name": name, "base_url": base_url,
            "api_key": api_key, "model": model.strip()}


def _public_ai_config():
    """Config safe for the browser: booleans instead of secrets.

    The stored api_key is NEVER echoed back -- the settings UI re-sends
    replaceSecret to keep it, so a stolen config response can't be replayed.
    """
    data = load_ai_config()
    servers = []
    for s in data.get("servers") or []:
        if not isinstance(s, dict):
            continue
        servers.append({
            "name": s.get("name", ""),
            "baseUrl": s.get("base_url", ""),
            "model": s.get("model", ""),
            "hasKey": bool(s.get("api_key")),
        })
    return {"servers": servers, "default": data.get("default", "")}


def _saved_server(name):
    """Fetch one stored server profile by its exact name, or None."""
    for s in load_ai_config().get("servers") or []:
        if isinstance(s, dict) and s.get("name") == name:
            return s
    return None


def _chat_url(base_url):
    """Normalize a saved base_url into the full chat-completions endpoint.

    Base URLs are stored without a trailing /v1 (sanitized on save), so the
    canonical path is appended here. Some servers need a distinct prefix;
    the user can put it in the base_url (e.g. .../v1/openai) and it flows
    through unchanged.
    """
    base = (base_url or "").rstrip("/")
    if base.lower().endswith("/v1"):
        base = base[:-3]
    return base + "/v1/chat/completions" if base else ""


def _sse_bytes(chunks):
    """Join upstream byte chunks into one bytes object (tests, not prod)."""
    return b"".join(chunks)


@app.route("/api/ai/config", methods=["GET"])
@admin_required
def ai_config_get():
    """Masked view of the saved AI provider profiles (admin-only:
    a viewer must not even learn which endpoints + models are set)."""
    return jsonify(_public_ai_config())


@app.route("/api/ai/config", methods=["POST"])
@admin_required
def ai_config_post():
    """Replace the saved provider profiles wholesale.

    Body: {"servers": [{name, baseUrl, apiKey?, model, replaceSecret?},
    ...], "default": "<name>"}. The list replaces the stored one but
    entries whose apiKey is "" + replaceSecret:true carry over the
    previously stored key, so the UI can round-trip profiles without
    echoing secrets back through the browser.
    """
    data, error = expect_json("servers")
    if error:
        return error
    servers_in = data.get("servers", [])
    default = data.get("default", "")
    if not isinstance(servers_in, list):
        return err("servers must be a list", 400)
    if not isinstance(default, str):
        return err("default must be a string", 400)
    cleaned = []
    seen = set()
    for i, raw in enumerate(servers_in):
        try:
            clean = _sanitize_server(raw, i)
        except ValueError as exc:
            return err(str(exc), 400)
        if any(s["name"] == clean["name"] for s in cleaned):
            return err("duplicate server name: %s" % clean["name"], 400)
        seen.add(clean["name"])
        cleaned.append(clean)
    if default and default not in seen:
        return err("default is not one of the server names", 400)
    try:
        save_ai_config({"servers": cleaned, "default": default})
    except OSError as exc:
        return err("Could not write AI config: %s" % exc, 500)
    return jsonify(_public_ai_config())


@app.route("/api/ai/probe", methods=["GET"])
@admin_required
def ai_probe():
    """Server-side reachability check for one saved provider.

    GET /api/ai/probe?server=<name>. A no-key 401 from the upstream is a
    SUCCESS here (the ask is 'can this server reach me', not 'is my key
    valid') so a user can verify a LAN ollama before pasting credentials.
    Everything is wrapped so an unroutable host errors cleanly instead of
    hanging the request thread.
    """
    name = (request.args.get("server") or "").strip()
    if not name:
        return err("Missing server parameter", 400)
    stored = _saved_server(name)
    if stored is None:
        return err("Unknown server: %s" % name, 404)
    url = _chat_url(stored.get("base_url", ""))
    if not url:
        return err("Server has no base URL", 400)
    payload = json.dumps({
        "model": "probe",
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
        "stream": False,
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload, method="POST",
        headers={"Content-Type": "application/json",
                 "Accept": "application/json",
                 **_upstream_auth_headers(stored)})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return jsonify({"ok": True, "status": resp.status})
    except urllib.error.HTTPError as exc:
        # The endpoint lives and answered -- that's what "probe" asks.
        return jsonify({"ok": True, "status": exc.code})
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 200


@app.route("/api/ai/chat", methods=["POST"])
@admin_required
def ai_chat():
    """Stream a chat completion through the saved upstream as SSE.

    Body: {"server": "<profile name>", "messages": [{role, content}, ...]}.
    The chosen profile's apiKey is attached server-side; the browser
    never sees it. The upstream SSE byte stream is relayed unmodified with
    Content-Type: text/event-stream (this endpoint IS the upstream body).
    """
    stored = _saved_server((request.get_json(silent=True) or {}).get("server", ""))
    if stored is None:
        return err("Unknown or missing server", 400)
    url = _chat_url(stored.get("base_url", ""))
    if not url:
        return err("Server has no baseUrl configured", 400)
    data = request.get_json()
    messages = data.get("messages")
    if not isinstance(messages, list) or not messages:
        return err("messages must be a non-empty list", 400)
    for m in messages:
        if (not isinstance(m, dict) or m.get("role") not in ("system", "user", "assistant")
                or not isinstance(m.get("content"), str)):
            return err("messages entries must be {role: system|user|assistant, content: str}",
                       400)
    # White-list the upstream payload: the browser's "server" selector and
    # any extra keys must not leak through to the provider.
    payload_body = {"model": stored.get("model") or "default",
                    "messages": messages, "stream": True}
    payload = json.dumps(payload_body).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload, method="POST",
        headers={"Content-Type": "application/json",
                 "Accept": "text/event-stream",
                 **_upstream_auth_headers(stored)})

    def relay():
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                # Relay raw bytes as they arrive; no buffering, no parsing.
                while True:
                    chunk = resp.read(1024)
                    if not chunk:
                        break
                    yield chunk
        except GeneratorExit:
            # Browser closed the connection mid-stream (stop button,
            # tab close). Abort the upstream read without turning the
            # normal disconnect into an error banner.
            raise
        except urllib.error.HTTPError as exc:
            # Upstream auth/model errors surface as SSE so the browser's
            # onmessage path shows them inline (EventSource can't read
            # non-200 statuses itself). The "error" flag is what the
            # client keys on; message/status carry the specifics.
            detail = exc.read(2048).decode("utf-8", "replace")
            yield "event: error\ndata: %s\n\n" % json.dumps(
                {"error": True, "status": exc.code,
                 "message": detail[:1500]})
        except (urllib.error.URLError, OSError, ValueError) as exc:
            yield "event: error\ndata: %s\n\n" % json.dumps(
                {"error": True, "status": 0, "message": str(exc)})

    return Response(relay(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-store",
                             "X-Accel-Buffering": "no"})


def _upstream_auth_headers(stored):
    """Auth headers for the upstream, from the profile's stored key."""
    key = stored.get("api_key") or ""
    return {"Authorization": "Bearer " + key} if key else {}


# --------------------------------------------------------------------------- #
# Routes: agent guide (/agent.md, served from agent.md)
# --------------------------------------------------------------------------- #
_AUTH_STATE_PLACEHOLDER = "{{auth_state}}"


@app.route("/agent.md", methods=["GET"])
def agent_guide():
    """Machine-oriented API guide for AI agents and scripts.

    The guide lives at the project root as plain Markdown (agent.md) so
    it can be read and maintained like any other doc; this route serves
    it verbatim as text/markdown with the current auth state substituted
    into a placeholder so the text never goes stale. Deliberately NOT
    gated: an agent needs to discover how to authenticate before it holds
    any credential, and the page contains endpoint documentation only --
    no notebook data, no secrets.
    """
    try:
        with open(AGENT_GUIDE_FILE, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return err("Agent guide (agent.md) is missing on the server", 500)
    if auth_enabled():
        state = ("**enabled** — every request must present a credential "
                 "(see Authentication below). Check `GET /api/auth` at "
                 "runtime instead of trusting this static text.")
    else:
        state = ("**disabled** — all endpoints are open without credentials. "
                 "If this changes, requests start returning 401 and you will "
                 "need to authenticate.")
    return text.replace(_AUTH_STATE_PLACEHOLDER, state), 200, {
        "Content-Type": "text/markdown; charset=utf-8",
        # The rendered auth state changes with config; never cache it.
        "Cache-Control": "no-store",
    }


# --------------------------------------------------------------------------- #
# Routes: file tree + read/write
# --------------------------------------------------------------------------- #
@app.route("/api/tree", methods=["GET"])
@read_login_required
def tree():
    return jsonify({"tree": build_tree(DATA_DIR)})


@app.route("/api/ls", methods=["GET"])
@read_login_required
def ls_dir():
    """Non-recursive listing of a single folder.

    Unlike /api/tree this shows EVERY file type (attachments included),
    carries size + mtime, and never descends into subfolders -- so an
    agent can inspect one directory without pulling the whole tree.
    Hidden entries (dotfiles, __pycache__) are skipped, matching the
    tree. Empty path lists the notebook root.
    """
    rel = request.args.get("path", "").strip()
    if rel in ("", "."):
        abs_dir = os.path.realpath(DATA_DIR)
        rel_out = ""
    else:
        abs_dir = safe_path(rel)
        if abs_dir is None:
            return err("Invalid path", 400)
        rel_out = rel_from(abs_dir)
    if not os.path.isdir(abs_dir):
        return err("Folder not found", 404)
    try:
        names = sorted(os.listdir(abs_dir))
    except OSError as exc:
        return err("Could not list folder: %s" % exc, 500)
    entries = []
    for name in names:
        if name.startswith(".") or name == "__pycache__":
            continue
        full = os.path.join(abs_dir, name)
        try:
            st = os.stat(full)
        except OSError:
            continue
        entries.append({
            "name": name,
            "type": "dir" if os.path.isdir(full) else "file",
            "size": st.st_size,
            "mtime": st.st_mtime,
        })
    entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
    return jsonify({"path": rel_out, "entries": entries})


@app.route("/api/file", methods=["GET"])
@read_login_required
def file_get():
    rel = request.args.get("path", "").strip()
    abs_path = safe_path(rel)
    if abs_path is None:
        return err("Invalid path", 400)
    if not os.path.isfile(abs_path):
        return err("File not found", 404)
    try:
        mtime = os.path.getmtime(abs_path)
    except OSError as exc:
        return err("Could not stat file: %s" % exc, 500)
    # Conditional GET: client can pass a prior mtime; if the file hasn't
    # changed since then, return 304 with no body. The browser uses the same
    # pattern as RFC 7232 If-Modified-Since, just on a custom field so we
    # don't depend on HTTP date parsing.
    if_modified = request.args.get("ifModifiedSince", "").strip()
    if if_modified:
        try:
            if float(if_modified) >= mtime:
                return ("", 304)
        except ValueError:
            pass   # bad client value -> fall through to the full response
    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError as exc:
        return err("Could not read file: %s" % exc, 500)
    return jsonify({"path": rel, "content": content, "size": len(content), "mtime": mtime})


@app.route("/api/file", methods=["POST"])
@admin_required
def file_save():
    data, error = expect_json("path", "content")
    if error:
        return error
    rel = data["path"]
    content = data["content"]
    if not isinstance(content, str):
        return err("content must be a string", 400)
    abs_path = safe_path(rel)
    if abs_path is None:
        return err("Invalid path", 400)
    parent = os.path.dirname(abs_path)
    if not os.path.isdir(parent):
        return err("Parent folder does not exist", 400)
    try:
        atomic_write(abs_path, content)
    except OSError as exc:
        return err("Could not write file: %s" % exc, 500)
    return jsonify({"path": rel, "size": len(content)})


@app.route("/api/file/append", methods=["POST"])
@admin_required
def file_append():
    """Append content to a file with a single O_APPEND write.

    The kernel guarantees the write lands at the current end of the
    file, so concurrent appends never clobber each other the way a
    read-modify-write via POST /api/file can. Body:
      {"path": "...", "content": "...", "create": false}
    With "create": true a missing file is created (its parent folder
    must already exist); without it a missing file is 404.
    """
    data, error = expect_json("path", "content")
    if error:
        return error
    rel = data["path"]
    content = data["content"]
    if not isinstance(content, str):
        return err("content must be a string", 400)
    abs_path = safe_path(rel)
    if abs_path is None:
        return err("Invalid path", 400)
    if not os.path.isdir(os.path.dirname(abs_path)):
        return err("Parent folder does not exist", 400)
    create_missing = bool(data.get("create", False))
    if not create_missing and not os.path.isfile(abs_path):
        return err("File not found (pass \"create\": true to create it)", 404)
    payload = memoryview(content.encode("utf-8"))
    try:
        fd = os.open(abs_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
        try:
            while payload:
                payload = payload[os.write(fd, payload):]
            size = os.fstat(fd).st_size
        finally:
            os.close(fd)
    except OSError as exc:
        return err("Could not append to file: %s" % exc, 500)
    return jsonify({"path": rel, "size": size,
                    "appended": len(content.encode("utf-8"))})


@app.route("/api/edit", methods=["POST"])
@admin_required
def file_edit():
    """Apply an ordered batch of patches to one file, all-or-nothing.

    Body: {"path": "...", "edits": [<op>, <op>, ...]}. Ops are applied
    in order to an in-memory buffer; the result is written back with the
    usual atomic temp-file + replace, so clients get partial-edit power
    without a full read-modify-write round trip or torn writes. If ANY
    op fails validation or application the whole batch is rejected with
    400 and the file is left untouched.

    Ops (see _apply_edits for exact semantics):
      {"op": "append",  "text": "..."}       -- add at end of file
      {"op": "prepend", "text": "..."}       -- insert at top of file
      {"op": "find_replace", "find": "...", "replace_with": "...",
       "count": 1, "regex": false, "ignore_case": false,
       "optional": false}                    -- literal by default; regex
            opts into re.subn semantics (\\1 backrefs work in regex mode).
            Zero matches is a 400 unless optional=true.
      {"op": "line_insert", "after_line": N | "before_line": N,
       "text": "..."}                        -- 1-based; after_line 0 = top
      {"op": "line_replace", "start": N, "end": M?, "text": "..."}
      {"op": "line_delete", "start": N, "end": M?}   -- end defaults to start

    Line ops normalise the buffer so it ends with a trailing newline.
    """
    data, error = expect_json("path", "edits")
    if error:
        return error
    rel = data["path"]
    edits = data["edits"]
    if not isinstance(edits, list) or not edits:
        return err("edits must be a non-empty list of ops", 400)
    abs_path = safe_path(rel)
    if abs_path is None:
        return err("Invalid path", 400)
    if not os.path.isfile(abs_path):
        return err("File not found", 404)
    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            original = f.read()
    except OSError as exc:
        return err("Could not read file: %s" % exc, 500)
    try:
        patched = _apply_edits(original, edits)
    except _EditError as exc:
        # Nothing has been written: batches are all-or-nothing.
        return err(str(exc), 400)
    try:
        atomic_write(abs_path, patched)
    except OSError as exc:
        return err("Could not write file: %s" % exc, 500)
    return jsonify({"path": rel, "size": len(patched), "applied": len(edits)})


# --------------------------------------------------------------------------- #
# Routes: create / move / copy / delete
# --------------------------------------------------------------------------- #
@app.route("/api/create", methods=["POST"])
@admin_required
def create():
    """Create a file or folder; idempotent with "upsert": true.

    Body: {"path": "...", "type": "file"|"dir",
           "upsert": false, "content": ""}.

    Without upsert (default) an existing target is a 409, exactly as
    before. With "upsert": true the call is an idempotent ensure-exists:
    an existing file/folder of the matching type succeeds with 200 and
    {"existed": true} and is NOT modified (content is ignored -- use
    POST /api/file to overwrite). A type mismatch (file vs folder at
    that path) is still a 409 even under upsert. When creating a file,
    optional "content" seeds it (default empty).
    """
    data, error = expect_json("path", "type")
    if error:
        return error
    rel = data["path"]
    item_type = data["type"]
    if item_type not in ("file", "dir"):
        return err("type must be 'file' or 'dir'", 400)
    upsert = data.get("upsert", False)
    if not isinstance(upsert, bool):
        return err("upsert must be a boolean", 400)
    content = data.get("content", "")
    if content is not None and not isinstance(content, str):
        return err("content must be a string", 400)
    abs_path = safe_path(rel)
    if abs_path is None:
        return err("Invalid path", 400)
    if os.path.exists(abs_path):
        if not upsert:
            return err("Already exists", 409)
        if item_type == "file" and not os.path.isfile(abs_path):
            return err("Already exists (as a folder)", 409)
        if item_type == "dir" and not os.path.isdir(abs_path):
            return err("Already exists (as a file)", 409)
        return jsonify({"path": rel, "existed": True})
    try:
        if item_type == "file":
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            atomic_write(abs_path, content or "")
        else:
            os.makedirs(abs_path, exist_ok=False)
    except OSError as exc:
        return err("Could not create: %s" % exc, 500)
    return jsonify({"path": rel, "existed": False})


def _conflict_response(data_key, data_value, on_conflict):
    """Shared destination-exists handling for move/copy.

    Returns (response, proceed) -- response is set when the request is
    finished (skip / error); proceed=True means overwrite was chosen and
    the caller should clear the way. """
    if on_conflict == "skip":
        return jsonify({data_key: data_value, "skipped": True}), False
    if on_conflict == "error":
        return err("Destination already exists", 409), False
    return None, True   # overwrite


@app.route("/api/move", methods=["POST"])
@admin_required
def move():
    """Move/rename; "onConflict" decides what happens if the target exists.

    Body: {"from": "...", "to": "...",
           "onConflict": "error"|"skip"|"overwrite"} (default "error").

      error      -- 409 if the destination exists (back-compat default)
      skip       -- no-op, 200 {"skipped": true}; source left untouched
      overwrite  -- destination is replaced

    When the destination does not exist the move of a plain file uses
    link()+unlink(), which fails atomically with EEXIST if another
    writer creates the target concurrently -- a true move-if-absent
    with no window where the destination is missing or partial.
    Filesystems without hardlink support fall back to check-then-rename.
    """
    data, error = expect_json("from", "to")
    if error:
        return error
    on_conflict = data.get("onConflict", "error")
    if on_conflict not in ("error", "skip", "overwrite"):
        return err("onConflict must be 'error', 'skip' or 'overwrite'", 400)
    src = safe_path(data["from"])
    dst = safe_path(data["to"])
    if src is None or dst is None:
        return err("Invalid path", 400)
    if not os.path.exists(src):
        return err("Source not found", 404)
    src_is_dir = os.path.isdir(src) and not os.path.islink(src)

    if os.path.exists(dst):
        response, proceed = _conflict_response("to", data["to"], on_conflict)
        if not proceed:
            return response
        try:
            _remove_path(dst)
        except OSError as exc:
            return err("Could not replace destination: %s" % exc, 500)

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    # Atomic move-if-absent for files: link() refuses to clobber.
    moved = False
    if not src_is_dir:
        try:
            os.link(src, dst)
            os.unlink(src)
            moved = True
        except FileExistsError:
            # Lost a race: something created dst after our check. The
            # conflict was already resolved above; surface it plainly
            # rather than guessing between skip/overwrite twice.
            return err("Destination already exists", 409)
        except OSError:
            moved = False   # hardlinks unsupported -> classic rename below
    if not moved:
        try:
            os.rename(src, dst)
        except OSError as exc:
            return err("Could not move: %s" % exc, 500)
    return jsonify({"from": data["from"], "to": data["to"]})


@app.route("/api/copy", methods=["POST"])
@admin_required
def copy():
    """Copy a file or folder; "onConflict" as in /api/move.

    Body: {"from": "...", "to": "...",
           "onConflict": "error"|"skip"|"overwrite"} (default "error").
    A file copy is created exclusively ('x' mode), so copy-if-absent
    never truncates or clobbers an existing destination, even under a
    race; a lost race surfaces as 409 (or skipped=true). Folders are
    copied recursively; for them the existence check is best-effort.
    """
    data, error = expect_json("from", "to")
    if error:
        return error
    on_conflict = data.get("onConflict", "error")
    if on_conflict not in ("error", "skip", "overwrite"):
        return err("onConflict must be 'error', 'skip' or 'overwrite'", 400)
    src = safe_path(data["from"])
    dst = safe_path(data["to"])
    if src is None or dst is None:
        return err("Invalid path", 400)
    if not os.path.exists(src):
        return err("Source not found", 404)
    src_is_dir = os.path.isdir(src) and not os.path.islink(src)

    if os.path.exists(dst):
        response, proceed = _conflict_response("to", data["to"], on_conflict)
        if not proceed:
            return response
        try:
            _remove_path(dst)
        except OSError as exc:
            return err("Could not replace destination: %s" % exc, 500)

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        if src_is_dir:
            shutil.copytree(src, dst)
        else:
            try:
                with open(dst, "xb") as out, open(src, "rb") as inp:
                    shutil.copyfileobj(inp, out)
            except FileExistsError:
                # Lost a race after the pre-check; same answer as above.
                if on_conflict == "skip":
                    return jsonify({"to": data["to"], "skipped": True})
                return err("Destination already exists", 409)
            except OSError:
                _remove_path(dst)   # drop any partial copy
                raise
            shutil.copystat(src, dst)
    except OSError as exc:
        return err("Could not copy: %s" % exc, 500)
    return jsonify({"to": data["to"]})


@app.route("/api/delete", methods=["POST"])
@admin_required
def delete():
    data, error = expect_json("path")
    if error:
        return error
    abs_path = safe_path(data["path"])
    if abs_path is None or abs_path == DATA_DIR:
        return err("Invalid path", 400)
    if not os.path.exists(abs_path):
        return err("Not found", 404)
    try:
        if os.path.isdir(abs_path):
            shutil.rmtree(abs_path)
        else:
            os.remove(abs_path)
    except OSError as exc:
        return err("Could not delete: %s" % exc, 500)
    return jsonify({"path": data["path"]})


# --------------------------------------------------------------------------- #
# Routes: search
# --------------------------------------------------------------------------- #
def _bounded_int_arg(name, default, ceiling):
    """Parse an optional query int, clamped to [1, ceiling]; None if bad."""
    raw = request.args.get(name, "")
    if raw == "":
        return default
    try:
        val = int(raw)
    except ValueError:
        return None
    return max(1, min(val, ceiling))


@app.route("/api/search", methods=["GET"])
@read_login_required
def search():
    """Line-oriented search with literal or regex patterns.

    Params (all optional except q):
      q         pattern; literal substring by default
      case=1    case-sensitive (default insensitive)
      regex=1   treat q as a Python regex instead of a literal
                (matched per line; invalid regex -> 400)
      file=rel  scope the scan to this single file (404 if missing)
      glob=p    fnmatch filter on the relative path OR basename,
                e.g. "notes/*.md" -- other files are not scanned
      limit=N   total match cap (default 200, ceiling 2000)
      perFile=N per-file match cap (default 20, ceiling 200)
      order=... reorder result files by "path" | "mtime" | "count"
                (default keeps root-first walk order); desc=1 reverses.
                Ordering regroups whole files, never splits a file's
                matches; caps still apply during the scan.

    Response shape is unchanged for existing callers:
      {query, matches: [{file, line, col, snippet}], truncated}
    plus "file" echoed back when ?file= scoped. The hit inside each
    snippet stays wrapped in <<...>> so clients can re-highlight safely.
    """
    query = request.args.get("q", "")
    if not query.strip():
        return err("Empty query", 400)
    case_sensitive = request.args.get("case", "0") == "1"
    use_regex = request.args.get("regex", "0") == "1"

    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        pattern = re.compile(query if use_regex else re.escape(query), flags)
    except re.error as exc:
        return err("Invalid regex: %s" % exc, 400)

    # Optional single-file scope (#6): search one specific file only.
    file_scope = request.args.get("file", "").strip()
    scoped = None
    if file_scope:
        scoped = safe_path(file_scope)
        if scoped is None:
            return err("Invalid path", 400)
        if not os.path.isfile(scoped):
            return err("File not found", 404)

    # Optional glob filter on which files are scanned at all.
    glob_pat = request.args.get("glob", "").strip()

    limit = _bounded_int_arg("limit", MAX_TOTAL_MATCHES,
                             MAX_TOTAL_MATCHES_CEILING)
    per_file_cap = _bounded_int_arg("perFile", MAX_MATCHES_PER_FILE,
                                    MAX_MATCHES_PER_FILE_CEILING)
    if limit is None or per_file_cap is None:
        return err("limit and perFile must be integers", 400)

    order = request.args.get("order", "").strip().lower()
    if order and order not in ("path", "mtime", "count"):
        return err("order must be 'path', 'mtime' or 'count'", 400)
    desc = request.args.get("desc", "0") == "1"

    # Collect per-file bundles, then order + flatten, so ?order= can
    # regroup files without changing the flat match-item shape.
    bundles = []
    total = 0
    truncated = False

    def _targets():
        if scoped is not None:
            yield rel_from(scoped), scoped
            return
        for dirpath, _dirs, filenames in os.walk(DATA_DIR):
            for name in sorted(filenames):
                if name.startswith(".") or not name.lower().endswith(".md"):
                    continue
                full = os.path.join(dirpath, name)
                yield rel_from(full), full

    for rel, full in _targets():
        if glob_pat and not (
                fnmatch.fnmatch(rel, glob_pat)
                or fnmatch.fnmatch(os.path.basename(rel), glob_pat)):
            continue
        try:
            with open(full, "r", encoding="utf-8", errors="replace") as f:
                lines = f.read().splitlines()
        except OSError:
            continue
        matches_in_file = []
        count_in_file = 0
        for i, line in enumerate(lines, 1):
            for m in pattern.finditer(line):
                if total >= limit:
                    truncated = True
                    break
                if count_in_file >= per_file_cap:
                    break
                start, end = m.start(), m.end()
                lo = max(0, start - SNIPPET_PAD)
                hi = min(len(line), end + SNIPPET_PAD)
                snippet = line[lo:hi]
                # Mark the match so the client can re-highlight safely.
                # Use offsets within the snippet so we don't corrupt HTML.
                snippet = (
                    snippet[: start - lo]
                    + "<<"
                    + snippet[start - lo : end - lo]
                    + ">>"
                    + snippet[end - lo :]
                )
                matches_in_file.append({
                    "file": rel,
                    "line": i,
                    "col": start + 1,
                    "snippet": snippet,
                })
                count_in_file += 1
                total += 1
            if truncated:
                break
        if matches_in_file:
            try:
                mtime = os.path.getmtime(full)
            except OSError:
                mtime = 0.0
            bundles.append((rel, mtime, matches_in_file))
        if truncated:
            break

    if order == "mtime":
        key = lambda bundle: bundle[1]
    elif order == "count":
        key = lambda bundle: len(bundle[2])
    elif order == "path":
        key = lambda bundle: bundle[0].lower()
    else:
        key = None
    if key is not None:
        bundles.sort(key=key, reverse=desc)

    matches_out = [m for _rel, _mtime, ms in bundles for m in ms]
    resp = {"query": query, "matches": matches_out, "truncated": truncated}
    if scoped is not None:
        resp["file"] = rel_from(scoped)
    return jsonify(resp)


# --------------------------------------------------------------------------- #
# Routes: graph
# --------------------------------------------------------------------------- #
# Wikilink graph: scans every .md file under DATA_DIR and extracts the
# links between notes so the frontend can draw a force-directed graph
# (Obsidian-style "graph view"). Two link syntaxes are recognised:
#
#   [[Target]]            -- a wikilink. The target is resolved to a .md
#                           file by stem (basename without extension)
#                           so [[README]] and [[README.md]] both link
#                           to README.md.
#   [text](path.md)       -- a standard Markdown link whose URL ends in
#                           .md. Relative paths are normalised against
#                           the linking file's folder so a link from
#                           notes/a.md to b.md points at notes/b.md.
#
# Anchor fragments (#heading) are stripped before resolution. Links to
# files that don't exist in the notebook are dropped (no "ghost" nodes);
# self-links are skipped (a file linking to itself adds no information).
# Edges are unique and undirected: A->B and B->A collapse to one edge.
#
# The endpoint is gated as a read (read_login_required) because it
# discloses notebook structure + filenames, exactly like /api/tree.
_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)]+\.md(?:#[^\s)]*)?)\)", re.IGNORECASE)


def _strip_fragment(target):
    """Drop a trailing #anchor from a link target."""
    if "#" in target:
        return target.split("#", 1)[0]
    return target


def _normalise_link(raw, src_rel, stem_index):
    """Resolve a link target against its source file.

    Returns the canonical relative path of the linked .md file, or None
    when the target can't be resolved to a known note. `stem_index` maps
    a file's basename-without-extension to its relative path (built once
    per graph build) so [[wikilinks]] by stem can be looked up cheaply.
    """
    target = _strip_fragment(raw.strip())
    if not target:
        return None
    # Absolute paths never resolve inside DATA_DIR (safe_path would block
    # them anyway); drop them.
    if os.path.isabs(target):
        return None
    # A wikilink with no path separator may be a bare stem. Try the stem
    # index first so [[README]] resolves even when the file lives in a
    # subfolder.
    if "/" not in target:
        stem = target
        if stem.lower().endswith(".md"):
            stem = stem[:-3]
        if stem in stem_index:
            return stem_index[stem]
    # Fall back to treating it as a relative path from the source's
    # folder, normalised so "../sub/x.md" can't escape DATA_DIR.
    src_dir = os.path.dirname(src_rel)
    candidate = os.path.normpath(os.path.join(src_dir, target))
    norm_data = os.path.normpath(DATA_DIR)
    abs_candidate = os.path.normpath(os.path.join(DATA_DIR, candidate))
    if abs_candidate == norm_data or abs_candidate.startswith(norm_data + os.sep):
        return candidate.replace(os.sep, "/")
    return None


def build_graph():
    """Walk DATA_DIR, parse every .md file for links, and return the graph.

    Shape:
      { "nodes": [ {"id": "notes/a.md", "name": "a.md", "links": 3}, ... ],
        "edges": [ {"source": "notes/a.md", "target": "notes/b.md"}, ... ] }

    `links` on a node is that node's degree (number of edges touching
    it); the frontend uses it to size nodes. Nodes are every .md file
    found, including orphans (files with no links in or out) so the graph
    matches the file tree the user sees in the Explorer.
    """
    files = []
    for dirpath, _dirs, filenames in os.walk(DATA_DIR):
        for name in filenames:
            if name.startswith(".") or not name.lower().endswith(".md"):
                continue
            full = os.path.join(dirpath, name)
            rel = rel_from(full)
            files.append(rel)

    # Stem index: basename-without-extension -> relative path. If two
    # files share a stem the first one wins (deterministic via os.walk
    # order); wikilinks to that stem resolve to it. Ambiguous stems are
    # rare in a single-user notebook and this keeps resolution cheap.
    stem_index = {}
    for rel in files:
        base = os.path.basename(rel)
        if base.lower().endswith(".md"):
            base = base[:-3]
        stem_index.setdefault(base, rel)

    contents = {}
    for rel in files:
        abs_path = os.path.join(DATA_DIR, rel)
        try:
            with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
                contents[rel] = f.read()
        except OSError:
            contents[rel] = ""

    edge_set = set()   # frozenset({src, dst}) for undirected dedup
    degree = {rel: 0 for rel in files}
    for src_rel in files:
        text = contents.get(src_rel, "")
        targets = set()
        for m in _WIKILINK_RE.finditer(text):
            resolved = _normalise_link(m.group(1), src_rel, stem_index)
            if resolved and resolved in degree:
                targets.add(resolved)
        for m in _MD_LINK_RE.finditer(text):
            resolved = _normalise_link(m.group(2), src_rel, stem_index)
            if resolved and resolved in degree:
                targets.add(resolved)
        for dst in targets:
            if dst == src_rel:
                continue
            key = frozenset((src_rel, dst))
            if key in edge_set:
                continue
            edge_set.add(key)
            degree[src_rel] += 1
            degree[dst] += 1

    nodes = [
        {"id": rel, "name": os.path.basename(rel), "links": degree[rel]}
        for rel in sorted(files)
    ]
    edges = []
    for e in edge_set:
        pair = sorted(e)
        edges.append({"source": pair[0], "target": pair[1]})
    return {"nodes": nodes, "edges": edges}


@app.route("/api/graph", methods=["GET"])
@read_login_required
def graph():
    return jsonify(build_graph())


# --------------------------------------------------------------------------- #
# SPA catch-all
# --------------------------------------------------------------------------- #
# The notebook is a single-page app: every path that isn't an /api/* route
# (or a /static/* file served by Flask's built-in static handler) should
# land on index.html, which boots the app and lets parseDeepLink in app.js
# decide what to do with the URL. This is what makes
# `http://server/README.md#core-rules` work -- a fresh load of any
# notebook file path serves the SPA shell, and the boot path opens the
# file + scrolls to the heading.
#
# Flask matches routes in registration order: the explicit /api/* routes
# above are tried first; the implicit /static/* handler is registered
# during `app = Flask(__name__)`; this catch-all only fires for paths
# that fell through both. The `p` parameter is unused -- the SPA does
# the routing. The path is captured with `<path:>` so subfolders
# (`/notes/a.md`) work, not just single segments.
@app.route("/", defaults={"p": ""})
@app.route("/<path:p>")
def spa(p):
    theme = _read_theme_preference()
    return render_template("index.html", theme=theme)


# --------------------------------------------------------------------------- #
# CLI / entrypoint
# --------------------------------------------------------------------------- #
def parse_args(argv=None):
    """Command-line options. `python app.py --help` shows usage."""
    parser = argparse.ArgumentParser(
        prog="app.py",
        description="Markdown notebook server. Run and open the printed URL "
                    "in a browser.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "-H", "--host",
        default="0.0.0.0",
        help="Bind address. Defaults to 0.0.0.0 so the server is reachable "
             "from other devices on the LAN; pass --host 127.0.0.1 to bind "
             "loopback only.",
    )
    parser.add_argument(
        "-p", "--port",
        type=int,
        default=5000,
        help="Port to listen on.",
    )
    parser.add_argument(
        "--debug", dest="debug",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Flask debug + auto-reload. Off by default; pass --debug to opt in.",
    )
    return parser.parse_args(argv)


def reachable_urls(host, port):
    """Return the list of http URLs the server is reachable on.

    Always includes the bind address itself plus ``localhost`` (handy when the
    user passed ``0.0.0.0`` or a numeric IP). Additionally enumerates the
    host's non-loopback IPv4 addresses so phones / other LAN devices can
    connect without having to look up the IP themselves.

    Failures (no network, no interfaces, weird hosts) are swallowed: the
    caller should still get *some* URLs to print.
    """
    urls = ["http://%s:%d" % (host, port)]
    if host not in ("localhost", "127.0.0.1", "::1"):
        urls.append("http://localhost:%d" % port)

    for ip in _lan_ipv4_addresses():
        if ip in (host, "127.0.0.1", "localhost"):
            continue
        urls.append("http://%s:%d" % (ip, port))
    return urls


def _lan_ipv4_addresses():
    """Best-effort list of non-loopback IPv4 addresses on this host.

    Tries two strategies:

    1. ``gethostbyname_ex`` against the hostname -- works on most desktops,
       fails on minimal containers where the hostname resolves only to
       ``127.0.1.1`` or similar.
    2. Opening a UDP socket and reading ``getsockname()`` -- a well-known
       trick that asks the kernel "if I sent a packet to 8.8.8.8 right now,
       which source IP would you use?", which yields the actual outbound
       interface IP even when DNS has nothing useful to say.

    Returns a de-duplicated list, preserving discovery order. Any error is
    swallowed and an empty list is returned.
    """
    found = []
    seen = set()

    def _add(ip):
        if not ip or ip in seen or ip.startswith("127."):
            return
        seen.add(ip)
        found.append(ip)

    # Strategy 1: hostname resolution.
    try:
        _hostname, _aliases, addrs = socket.gethostbyname_ex(socket.gethostname())
        for ip in addrs:
            _add(ip)
    except socket.gaierror:
        pass

    # Strategy 2: ask the kernel for the outbound interface IP.
    if not found:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                # No packet is actually sent; this just makes the kernel pick
                # a source address.
                s.connect(("8.8.8.8", 80))
                _add(s.getsockname()[0])
        except OSError:
            pass

    return found


seed_notes = seed()

# Load (or generate) the auth secret and use it as Flask's session-signing key.
# Done after seed() so auth.json is always inside an existing CONFIG_DIR.
_auth_state = ensure_auth_secret()
app.secret_key = _auth_state["secret"]

if __name__ == "__main__":
    args = parse_args()
    print("Markdown notebook server")
    print("  notebook: %s" % DATA_DIR)
    print("  config  : %s" % CONFIG_DIR)
    for note in seed_notes:
        print("  " + note)
    print("  -> http://%s:%d  (Ctrl+C to quit)" % (args.host, args.port))
    for url in reachable_urls(args.host, args.port)[1:]:
        print("  -> %s" % url)
    if args.debug and args.host not in ("127.0.0.1", "localhost"):
        print("  WARNING: --debug with a non-loopback host exposes the "
              "interactive debugger to anyone on the network. Pass --no-debug "
              "if the server is reachable beyond your machine.")
    app.run(host=args.host, port=args.port, debug=args.debug)