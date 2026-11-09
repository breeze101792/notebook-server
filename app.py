"""Markdown notebook server.

A small, single-user Flask app that serves a Markdown notebook over the web.
Backend (this file) is JSON-only; the frontend lives under templates/ + static/
and renders Markdown client-side. Notebook data lives in data/, user config in
config/ -- two separate folders by design.

Workspaces
----------
A workspace is a directory the server is allowed to read and write as the
user running this process, so adding one is a deliberate grant of that
access. Added roots may not overlap the install or config directory. Enable
authentication whenever the server is bound to a non-loopback address.
"""

import argparse
import dataclasses
import fnmatch
import html
import http.client
import ipaddress
import itertools
import json
import math
import os
import re
import secrets
import shutil
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import bcrypt
from flask import (Flask, Response, g, has_request_context, jsonify,
                   render_template, request, send_from_directory, session)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# NOTEBOOK_DATA_DIR / NOTEBOOK_CONFIG_DIR let tests (and alternate installs)
# point the data and config folders elsewhere. Default to the project folders.
DATA_DIR = os.environ.get("NOTEBOOK_DATA_DIR") or os.path.join(BASE_DIR, "notebook")

CONFIG_DIR = os.environ.get("NOTEBOOK_CONFIG_DIR") or os.path.join(BASE_DIR, "config")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
# Serialises every config.json read-modify-write (set_config, the
# workspace-state merge and the one-shot startup migration). Without it two
# concurrent writers each read the old blob and the later write silently
# loses the other's update. Reads stay lock-free: atomic_write publishes a
# complete file, so a reader never sees a partial document.
_CONFIG_LOCK = threading.Lock()
# Auth lives in its own file so the UI-prefs blob (POSTed by any client) can
# never accidentally include hashed credentials. Schema:
#   {"secret": "<hex>", "admin_password_hash": "<bcrypt>", "viewer_password_hash": "<bcrypt>",
#    "tokens": [{"name": "...", "role": "admin"|"viewer", "id": "<10 hex>",
#                "hash": "<bcrypt of full token string>", "created": <unix ts>}]}
# Either password hash may be empty/missing to leave that role disabled. If
# both are unset the whole auth layer is bypassed (and tokens are cleared --
# they would be meaningless while every route is open).
AUTH_FILE = os.path.join(CONFIG_DIR, "auth.json")
# Multi-workspace registry. Server-owned on purpose: a workspace is a named
# root folder, and a client that could point the server at any path could
# read every file the server account can read. The default entry is always
# present and always first; extra entries are added through the admin-gated
# routes below, never edited by hand for the path.
WORKSPACES_FILE = os.path.join(CONFIG_DIR, "workspaces.json")
WORKSPACES_VERSION = 1
WORKSPACE_DEFAULT_ID = "default"
WORKSPACE_DEFAULT_NAME = "Notebook"
# Request header naming the workspace a client wants to talk to. Kept out
# of the URL so every existing link keeps working against the active root.
WORKSPACE_HEADER = "X-Notebook-Workspace"
WORKSPACE_MAX_COUNT = 32
WORKSPACE_NAME_MAX = 60
WORKSPACE_ID_SLUG_MAX = 32
WORKSPACE_ID_SUFFIX_BYTES = 2        # 4 hex chars: short, still collision-free
WORKSPACE_STATE_MAX_BYTES = 256 * 1024
# The registry holds at most WORKSPACE_MAX_COUNT entries of a name and a
# path, so 64 KiB is generous. The cap exists because the file is parsed on
# every request and on the request hook: json.load on a huge document raises
# MemoryError, and on a deeply nested one RecursionError, which would turn
# every request -- including /static/* -- into a 500.
WORKSPACES_MAX_BYTES = 64 * 1024
# A reverse proxy on the same host dials in from 127.0.0.1, so the peer
# address alone cannot separate a LAN client from a local one. Any request
# carrying one of these headers is treated as remote by the auth-off
# workspace gate.
PROXY_FORWARD_HEADERS = ("X-Forwarded-For", "X-Real-IP")
# Content keys that used to sit at the top level of config.json and now live
# under workspaceState["<id>"]. Kept as a tuple so the one-shot startup
# migration and the ACP preamble agree on exactly which keys are scoped.
_WORKSPACE_SCOPED_CONFIG_KEYS = (
    "lastFile", "openFiles", "activeFile", "pinnedFiles",
    "recentFiles", "bookmarks", "pinnedFolders",
    "sessions", "activeSessionId",
)

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
# Wall-clock budget for the two whole-workspace scans (/api/search and
# /api/graph). A workspace can be any local folder, so a file-count cap is
# the wrong bound: it cuts a legitimately large notebook short while still
# leaving a slow network mount able to hold a worker for minutes. A deadline
# bounds the only thing the user feels -- elapsed time -- and lets a big but
# fast notebook finish complete. Read at request time, so a test can set
# app.SCAN_TIMEOUT_SECONDS = 0 to force expiry.
SCAN_TIMEOUT_SECONDS = 5.0
# Lines between deadline checks inside one file. Small enough that a slow
# single file cannot overrun the deadline for long, large enough that a
# normal scan does not pay a clock read per line.
SCAN_CHECK_LINES = 256

# Hard cap on any request body, enforced by Flask before a route reads it.
# /api/ai/chat re-uploads the whole conversation each turn, images included
# as base64 data URLs, so the bound must clear a legitimate vision turn.
MAX_REQUEST_BYTES = 32 * 1024 * 1024  # 32 MiB

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES
# Template edits must take effect without a server restart: this process can
# run for weeks, and a cached index.html hid newly added edit-bar controls.
app.config["TEMPLATES_AUTO_RELOAD"] = True

# Paths whose responses must never be cached by the browser or any
# intermediary. These are the gated read endpoints (tree, file, search,
# config GET, info) -- caching them would let a previously-authorized
# client re-display the content after the auth state tightens (e.g. the
# admin enables the viewer password), which is exactly the leak the
# user reported. `no-store` makes the response treat the cache as
# forbidden; `private` prevents shared caches from holding it.
_GATED_READ_PATHS = (
    "/api/tree", "/api/ls", "/api/file", "/api/search", "/api/config", "/api/info",
    "/api/workspaces", "/api/graph", "/api/workspace-state",
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
    is also told to drop the response.

    Every /api/* response also varies on the workspace header: the same
    URL answers with a different notebook depending on it, so a cache
    that does keep a response must key on the header to avoid serving
    one workspace's tree for another.
    """
    if request.path in _GATED_READ_PATHS:
        resp.headers["Cache-Control"] = "no-store, private"
    if request.path.startswith("/api/"):
        vary = resp.headers.get("Vary")
        if not vary:
            resp.headers["Vary"] = WORKSPACE_HEADER
        elif WORKSPACE_HEADER.lower() not in vary.lower():
            resp.headers["Vary"] = "%s, %s" % (vary, WORKSPACE_HEADER)
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
def safe_path(rel_path, root=None):
    """Resolve a user-supplied relative path against a notebook root safely.

    `root` is the active workspace root (current_root()); it defaults to
    DATA_DIR so direct helper calls outside a request context keep their
    old single-root behaviour. Returns the normalised absolute path if it
    stays within `root`, else None. Blocks `..` traversal and absolute
    input. Interior symlinks that point outside the resolved root are
    allowed (the user created them intentionally via the filesystem).

    The returned path is the LEXICALLY normalised one (no realpath),
    so it always starts with `root` itself. Callers use it both as a
    filesystem path (open/os.remove: the kernel follows interior
    symlinks transparently) and as an identity for boundary checks
    (delete/move/copy root guards, rel_from()). Resolving symlinks here
    would break both: the guards would compare a resolved path against
    the unresolved root string, and rel_from() would emit garbage
    like ../real_notebook/x when the root itself is a symlink. It also
    keeps operations ON a symlink operating on the LINK (delete removes
    the link, not its target), matching rm/mv/cp semantics.
    """
    if root is None:
        root = DATA_DIR
    if not rel_path or not isinstance(rel_path, str):
        return None
    rel = rel_path.strip()
    if not rel:
        return None
    # Reject absolute input outright (/etc/passwd, C:\...) rather than
    # normalising it into a path inside the root.
    if os.path.isabs(rel):
        return None
    candidate = os.path.normpath(os.path.join(root, rel))
    # Boundary check against the unresolved root so that interior
    # symlinks (e.g. notebook/projects -> /some/other/folder) are not
    # blocked — the normalized path still starts with the root before
    # symlink resolution. `..` segments are resolved lexically by
    # normpath, so a symlink component followed by ".." cannot escape
    # either (the ".." applies to the root prefix, not the link
    # target).
    norm_root = os.path.normpath(root)
    if candidate == norm_root or candidate.startswith(norm_root + os.sep):
        return candidate
    return None


def err(message, status=400, code=None):
    """Error body shared by every route: {"error": ...} plus a stable
    machine-readable `code` when the route names one."""
    payload = {"error": message}
    if code:
        payload["code"] = code
    return jsonify(payload), status


@app.errorhandler(413)
def _request_too_large(_exc):
    """Answer an oversized body (over MAX_CONTENT_LENGTH) with JSON.

    Flask's default 413 is an HTML page; the SPA expects the same
    {"error": ...} shape every other route returns, so replace it.
    """
    return err("Request body too large", 413)


def expect_json(*required_keys, code=None):
    """Validate the request body is a JSON object with the required keys.

    Returns (data, None) on success or (None, error_response). `code` is
    attached to both failure responses so a route family can label a bad
    body consistently.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None, err("Expected a JSON object body", 400, code=code)
    for key in required_keys:
        if key not in data:
            return None, err("Missing required field: %s" % key, 400, code=code)
    return data, None


def rel_from(abs_path, root=None):
    """Render an absolute path inside a notebook root as a relative path.

    `root` defaults to DATA_DIR for direct calls outside a request
    context. abs_path comes from safe_path(), which returns the lexically
    normalised path (NOT a symlink-resolved one), so the relpath() here
    stays a pure string operation on the shared root prefix.
    """
    if root is None:
        root = DATA_DIR
    rel = os.path.relpath(abs_path, os.path.normpath(root))
    return rel.replace(os.sep, "/")


def atomic_write(path, content):
    """Write `content` to `path` atomically (temp file + os.replace).

    The temp file gets a UNIQUE name (pid + thread id + counter): a
    fixed "<path>.tmp" is shared by every concurrent writer to the same
    target, so one writer's os.replace() would unlink the temp file out
    from under the others (FileNotFoundError on their replace, i.e. a
    500 for a user save) and two interleaved open("w")s could publish
    torn content. Unique names keep each write self-contained while
    still replacing atomically; the counter is process-unique.
    """
    tmp = "%s.%s.tmp" % (path, _tmp_suffix())
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)


_tmp_counter = itertools.count()


def _tmp_suffix():
    """Unique-per-call temp-file suffix (pid + thread id + counter)."""
    return "%d.%d.%d" % (os.getpid(), threading.get_ident(), next(_tmp_counter))


def build_tree(path, root=None):
    """Recursively build a dirs-first, files-second tree of .md files.

    `root` is the workspace root the paths are rendered relative to; it
    defaults to DATA_DIR, and callers walking a non-default workspace pass
    the same root they are walking. Skips dotfiles and __pycache__.
    """
    if root is None:
        root = DATA_DIR
    entries = []
    try:
        names = sorted(os.listdir(path))
    except OSError:
        return entries
    for name in names:
        if name.startswith(".") or name == "__pycache__":
            continue
        full = os.path.join(path, name)
        rel = rel_from(full, root)
        if os.path.isdir(full):
            entries.append({
                "name": name,
                "type": "dir",
                "path": rel,
                "children": build_tree(full, root),
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
    """Persist the auth dict atomically (same pattern as config.json).

    Uses a unique temp name (see atomic_write): a fixed "<file>.tmp" is
    shared across concurrent writers and one writer's os.replace makes
    the others' replace raise FileNotFoundError.
    """
    tmp = "%s.%s.tmp" % (AUTH_FILE, _tmp_suffix())
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, AUTH_FILE)


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
# Workspace registry
# --------------------------------------------------------------------------- #
# One process serves several notebook roots ("workspaces"). The registry is
# a server-owned JSON file next to auth.json, read on every request: the file
# is tiny, and the test suite wipes CONFIG_DIR between cases, so a process
# cache would serve a stale list. The default workspace is synthesised from
# DATA_DIR and cannot be removed.
def _default_workspace():
    """The implicit workspace pointing at DATA_DIR (unresolved, as defined)."""
    return {"id": WORKSPACE_DEFAULT_ID, "name": WORKSPACE_DEFAULT_NAME,
            "path": DATA_DIR}


def _normalise_workspace_entry(raw):
    """Return a usable {id, name, path} entry from stored JSON, or None.

    A hand-edited entry with a relative path is dropped: every consumer
    treats the stored path as an absolute root, so a relative one would
    otherwise resolve against whatever the process cwd happens to be.
    """
    if not isinstance(raw, dict):
        return None
    wid = raw.get("id")
    name = raw.get("name")
    path = raw.get("path")
    if not isinstance(wid, str) or not wid:
        return None
    if not isinstance(name, str) or not name.strip():
        return None
    if not isinstance(path, str) or not path.strip():
        return None
    if not os.path.isabs(path.strip()):
        return None
    return {"id": wid, "name": name.strip(), "path": path.strip()}


_workspace_warn_seen = {}


def _warn_workspace_once(kind, message):
    """One stderr line per unchanged workspaces.json (mtime granularity).

    load_workspaces() runs on every request, including /static/* and /sw.js,
    so a per-request warning would flood the log for a registry the operator
    already knows is broken. A changed file gets a fresh warning.
    """
    try:
        stamp = os.path.getmtime(WORKSPACES_FILE)
    except OSError:
        stamp = -1.0
    key = (kind, stamp)
    if key in _workspace_warn_seen:
        return
    _workspace_warn_seen[key] = True
    sys.stderr.write(message + "\n")


def _load_workspace_blob():
    """Parse workspaces.json; return {} when missing, corrupt or unreadable.

    Never raises: a broken registry must degrade to "default workspace
    only" instead of turning every request into a 500.
    """
    try:
        if os.path.getsize(WORKSPACES_FILE) > WORKSPACES_MAX_BYTES:
            _warn_workspace_once(
                "oversize",
                "workspaces.json ignored: larger than %d bytes"
                % WORKSPACES_MAX_BYTES)
            return {}
        with open(WORKSPACES_FILE, "r", encoding="utf-8") as f:
            blob = json.load(f)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError, RuntimeError, MemoryError) as exc:
        _warn_workspace_once("corrupt", "workspaces.json ignored: %s" % exc)
        return {}
    return blob if isinstance(blob, dict) else {}


def save_workspaces(items):
    """Persist the registry atomically; a write failure is not fatal.

    Read-modify-write is fine here: only an admin can mutate the registry,
    and atomic_write keeps a crash mid-write from leaving half a file.
    """
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        atomic_write(WORKSPACES_FILE, json.dumps(
            {"version": WORKSPACES_VERSION, "items": items}, indent=2))
    except OSError as exc:
        sys.stderr.write("could not write workspaces.json: %s\n" % exc)


def load_workspaces():
    """Return the workspace registry with the default entry first.

    Pure in memory: it synthesises the default when the file is missing,
    empty, corrupt or has no default entry, and it always overwrites the
    default's path with the unresolved DATA_DIR string (the identity
    safe_path() and rel_from() compare against). A workspaces.json carried
    between installs must not keep serving the old root. Persistence belongs
    to the mutating routes and to _persist_workspaces_if_changed() at
    startup -- this function also runs for /static/* and /sw.js, which must
    never write a server-owned file.
    """
    blob = _load_workspace_blob()
    raw_items = blob.get("items")
    items = []
    seen = set()
    default_entry = None
    dropped = 0
    if isinstance(raw_items, list):
        for raw in raw_items:
            # The default's stored path is always discarded in favour of the
            # current install's DATA_DIR, so only its name matters here. A
            # carried file with a stale or even relative default path still
            # keeps the name the user gave it.
            if (isinstance(raw, dict)
                    and raw.get("id") == WORKSPACE_DEFAULT_ID):
                if default_entry is not None:
                    continue
                stored_name = raw.get("name")
                if isinstance(stored_name, str) and stored_name.strip():
                    default_entry = {
                        "id": WORKSPACE_DEFAULT_ID,
                        "name": stored_name.strip(),
                        "path": DATA_DIR,
                    }
                continue
            entry = _normalise_workspace_entry(raw)
            if entry is None:
                continue
            if entry["id"] in seen:
                continue
            if len(items) >= WORKSPACE_MAX_COUNT - 1:
                # Deterministic: the default plus the first entries on disk.
                dropped += 1
                continue
            seen.add(entry["id"])
            items.append(entry)
    if dropped:
        _warn_workspace_once(
            "overflow",
            "workspaces.json has more than %d entries; kept the default and "
            "the first %d" % (WORKSPACE_MAX_COUNT, WORKSPACE_MAX_COUNT - 1))
    if default_entry is None:
        default_entry = _default_workspace()
    return [default_entry] + items


def _persist_workspaces_if_changed():
    """Rewrite workspaces.json when the stored registry is not canonical.

    Called once at startup. Returns True when it wrote, so the caller can
    report a first-run registry creation.
    """
    blob = _load_workspace_blob()
    canonical = load_workspaces()
    if blob.get("items") == canonical:
        return False
    save_workspaces(canonical)
    return True


def resolve_workspace(workspace_id):
    """Return the stored entry for an id, or None when it is unknown."""
    for entry in load_workspaces():
        if entry["id"] == workspace_id:
            return entry
    return None


def _active_workspace_id():
    """The workspace id bound to this request, default outside one."""
    if has_request_context():
        wid = g.get("workspace_id")
        if wid:
            return wid
    return WORKSPACE_DEFAULT_ID


def current_root():
    """Absolute root of the active workspace for this request.

    Falls back to DATA_DIR outside a request context (direct helper calls
    and the CLI) so the helpers keep their original single-root behaviour.
    """
    if has_request_context():
        root = g.get("data_dir")
        if root:
            return root
    return DATA_DIR


def _workspace_public(entry):
    """Client view of one entry; `path` stays as stored (unresolved default)."""
    return {
        "id": entry["id"],
        "name": entry["name"],
        "path": entry["path"],
        "available": os.path.isdir(entry["path"]),
        "is_default": entry["id"] == WORKSPACE_DEFAULT_ID,
    }


def _paths_overlap(path_a, path_b):
    """True when the two real paths are equal or one contains the other.

    Both sides go through os.path.normcase so a case-insensitive filesystem
    (macOS, Windows) cannot smuggle a differently-cased route into the
    install or config directory past the check.
    """
    real_a = os.path.normcase(os.path.realpath(path_a))
    real_b = os.path.normcase(os.path.realpath(path_b))
    return (real_a == real_b
            or real_a.startswith(real_b + os.sep)
            or real_b.startswith(real_a + os.sep))


def _same_file(path_a, path_b):
    """True when both paths resolve to one existing file, else False."""
    try:
        return os.path.samefile(path_a, path_b)
    except (OSError, ValueError):
        return False


def _same_entry(path_a, path_b):
    """True when both paths name one existing directory entry.

    lstat() is compared as a stat pair, so an intermediate symlink is
    followed but a final-component symlink is not: a link and its target are
    two entries, not one.
    """
    try:
        st_a = os.lstat(path_a)
        st_b = os.lstat(path_b)
    except (OSError, ValueError):
        return False
    # A filesystem that reports st_ino 0 makes samestat() compare st_dev
    # alone; without this a case-differing pair could look like one entry.
    if not st_a.st_ino or not st_b.st_ino:
        return False
    return os.path.samestat(st_a, st_b)


def _same_file_ignoring_case(path_a, path_b):
    """True when both paths name one entry in two spellings of one case.

    The casefold compare is what fires on macOS, where normcase() is the
    identity.
    """
    if path_a == path_b:
        return False
    if not _same_entry(path_a, path_b):
        return False
    return (os.path.normcase(path_a).casefold()
        == os.path.normcase(path_b).casefold())


def _resolves_to_root(path, root):
    """True when `path` is the notebook root itself; a symlink to it is not."""
    if path == root:
        return True
    if os.path.islink(path):
        return False
    return _same_file(path, root)


def _is_within(path, folder):
    """True when `path` sits inside `folder` once symlinks are resolved.

    Each existing ancestor is compared by inode, so a case-insensitive
    filesystem cannot spell its way past the check and a symlinked folder is
    followed the way the move or copy will follow it.
    """
    folder_real = os.path.realpath(folder)
    current = os.path.realpath(path)
    while True:
        parent = os.path.dirname(current)
        if parent == current:
            return False
        current = parent
        if _same_file(current, folder_real):
            return True


def _workspace_name_problem(name, items, exclude_id=None):
    """Return (message, code) for an invalid name, or None when it is fine."""
    if not isinstance(name, str) or not name.strip():
        return ("Give the workspace a name.", "name_empty")
    if len(name.strip()) > WORKSPACE_NAME_MAX:
        return ("Workspace names are limited to %d characters."
                % WORKSPACE_NAME_MAX, "name_too_long")
    lowered = name.strip().lower()
    for entry in items:
        if entry["id"] != exclude_id and entry["name"].lower() == lowered:
            return ('A workspace called "%s" already exists.' % name.strip(),
                    "name_duplicate")
    return None


def _workspace_path_problem(path, items):
    """Return (message, code) for an unusable folder, or None when it is fine.

    The candidate is compared by realpath so a symlinked route into an
    existing root is caught too. It must not overlap another workspace (the
    delete/move/copy root guards only know the active root), and it must not
    overlap BASE_DIR or CONFIG_DIR -- /api/file could otherwise write app.py
    or config/auth.json through the open admin API. Every comparison is
    normcased on both sides so a case-insensitive filesystem cannot dodge
    the install/config exclusion.
    """
    if not isinstance(path, str) or not path.strip():
        return ("Use an absolute path, like /home/you/notes.",
                "path_not_absolute")
    candidate = path.strip()
    if not os.path.isabs(candidate):
        return ("Use an absolute path, like /home/you/notes.",
                "path_not_absolute")
    if not os.path.exists(candidate):
        return ("That folder doesn't exist.", "path_missing")
    if not os.path.isdir(candidate):
        return ("That path is a file, not a folder.", "path_not_directory")
    if not os.access(candidate, os.R_OK | os.X_OK):
        return ("That folder can't be read. Check its permissions.",
                "path_unreadable")
    real_base = os.path.normcase(os.path.realpath(BASE_DIR))
    real_candidate = os.path.normcase(os.path.realpath(candidate))
    if (real_candidate == real_base
            or real_candidate.startswith(real_base + os.sep)):
        return ("That folder is inside the server's install folder. "
                "Pick a folder outside it.", "path_inside_install")
    # "Overlaps" also catches a candidate that CONTAINS the install or config
    # folder, which would hand the open file API the server's own source and
    # credentials just as surely as putting the root inside them would.
    if (_paths_overlap(candidate, BASE_DIR)
            or _paths_overlap(candidate, CONFIG_DIR)):
        return ("That folder overlaps the server's install or config folder. "
                "Pick another folder.", "path_inside_install")
    for entry in items:
        if _paths_overlap(candidate, entry["path"]):
            return ('This folder overlaps "%s" (%s). Workspaces can\'t '
                    'contain one another.' % (entry["name"], entry["path"]),
                    "path_overlap")
    return None


def _new_workspace_id(name, items):
    """Derive an immutable, URL-safe id: name slug plus a random suffix.

    The suffix keeps same-named entries apart; the id never changes when a
    workspace is renamed. "default" is reserved and can never be generated
    because "default" plus a suffix is never equal to it.
    """
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    base = base[:WORKSPACE_ID_SLUG_MAX] or "workspace"
    existing = {entry["id"] for entry in items}
    candidate = "%s-%s" % (base, secrets.token_hex(WORKSPACE_ID_SUFFIX_BYTES))
    if candidate in existing:
        candidate = "ws-%s" % secrets.token_hex(WORKSPACE_ID_SUFFIX_BYTES)
    return candidate


def _is_loopback(addr):
    """True when `addr` is a loopback IP literal."""
    if not addr:
        return False
    try:
        return ipaddress.ip_address(addr).is_loopback
    except ValueError:
        return addr == "localhost"


def workspace_admin_required(view):
    """Admin-only, plus loopback-only while the auth layer is off.

    With auth on, the resolved role must be admin (and a viewer is refused
    with `not_admin`). With auth off every route is a pass-through, so every
    host on the LAN could otherwise add or remove a root folder; in that mode
    the request must come from a loopback address AND must not carry any
    PROXY_FORWARD_HEADERS value. A reverse proxy on the same host connects
    from 127.0.0.1, so a peer-address test alone would treat every proxied
    LAN client as local; a forwarding header is the signal that the request
    arrived through such a proxy.
    """
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not auth_enabled():
            forwarded = any(request.headers.get(name)
                            for name in PROXY_FORWARD_HEADERS)
            if forwarded or not _is_loopback(request.remote_addr):
                return err("Workspace changes from another machine require "
                           "admin authentication", 403,
                           code="loopback_required")
            return view(*args, **kwargs)
        role, error = _request_role()
        if error:
            return error
        if role != "admin":
            return err("Forbidden", 403, code="not_admin")
        return view(*args, **kwargs)

    return wrapped


def _unknown_workspace_response():
    """404 for an unknown workspace id, for the data views to call.

    _bind_workspace cannot answer the 404 itself: it runs before every
    view's auth decorator, so aborting there would leak whether an id exists
    to an unauthenticated caller and would break login, auth, config,
    workspace-list and the SPA shell for a tab whose workspace was removed.
    It instead records g.workspace_unknown and binds the default root. The
    data views call this helper after their gate has passed.

    An anonymous caller is skipped so the decorator's 401 (or a bearer
    token's own result) is what it sees; a Bearer credential authenticates
    without a session role, so it is treated as gated here.
    """
    if not g.get("workspace_unknown"):
        return None
    bearer = request.headers.get("Authorization", "").startswith("Bearer ")
    if auth_enabled() and not session.get("role") and not bearer:
        return None
    return err("Unknown workspace", 404, code="unknown_workspace")


@app.before_request
def _bind_workspace():
    """Bind the request's workspace to g.data_dir / g.workspace_id.

    Resolution order: the X-Notebook-Workspace header, then
    session["workspace"], then the default. An unknown id never aborts the
    request here: this hook runs ahead of every auth decorator, so a 404
    would both leak id validity to an anonymous caller and lock a tab out
    of login/auth when its workspace was removed. Instead the flag is
    recorded and the default root is bound; the gated data views call
    _unknown_workspace_response() and the SPA shell falls back silently,
    clearing the stale session value so a bad cookie cannot trap the user.
    """
    if request.path.startswith("/static/") or request.path == "/sw.js":
        # No asset reads the bound root. Skipping the registry parse keeps a
        # broken or oversized registry from taking the CSS and JS down too.
        g.workspace_unknown = False
        g.data_dir = DATA_DIR
        g.workspace_id = WORKSPACE_DEFAULT_ID
        return
    items = load_workspaces()
    by_id = {entry["id"]: entry for entry in items}
    requested = (request.headers.get(WORKSPACE_HEADER) or "").strip()
    if not requested:
        stored = session.get("workspace")
        if isinstance(stored, str):
            requested = stored.strip()
    entry = by_id.get(requested) if requested else None
    g.workspace_unknown = bool(requested) and entry is None
    if g.workspace_unknown:
        if not request.path.startswith("/api/"):
            if session.get("workspace") == requested:
                session.pop("workspace", None)
        entry = by_id.get(WORKSPACE_DEFAULT_ID)
    if entry is None:
        # The registry always carries the default; this is belt and braces.
        entry = _default_workspace()
    g.data_dir = entry["path"]
    g.workspace_id = entry["id"]


# --------------------------------------------------------------------------- #
# Routes: page + config
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return _render_index()


# iOS probes these two paths when it creates a Home Screen web clip, even
# with an <link rel="apple-touch-icon"> present. Without explicit routes the
# SPA catch-all answers with HTML, which iOS caches as a broken icon.
@app.route("/apple-touch-icon.png")
@app.route("/apple-touch-icon-precomposed.png")
def apple_touch_icon():
    return send_from_directory(
        os.path.join(BASE_DIR, "static", "icons"),
        "apple-touch-icon-v2.png",
        mimetype="image/png",
    )


# The service worker must be served from the site root. A worker loaded
# from /static/sw.js has a /static/ scope by default, so it can never
# control the app shell at "/" and the PWA is not offline-capable.
@app.route("/sw.js")
def service_worker():
    resp = send_from_directory(
        os.path.join(BASE_DIR, "static"), "sw.js",
        mimetype="application/javascript",
    )
    resp.headers["Cache-Control"] = "no-cache"
    return resp


# --------------------------------------------------------------------------- #
# First-paint boot state
# --------------------------------------------------------------------------- #
# The SPA applies the saved theme, title, font size, pane widths, collapse
# state, active side-panel view, and wallpaper from /api/config -- but that
# fetch is async, so the browser paints the defaults first and then visibly
# reflows once the response lands (title changes, icon/text size jumps,
# panes snap open or shut, the file tree flashes before the saved view).
# To avoid that flash we render the same values into the HTML shell
# server-side, so the very first frame already matches the saved config.
#
# These defaults must stay in sync with DEFAULTS in static/js/app.js. The
# values are the ONLY config fields ever embedded in the page, and every
# one is validated/clamped here so a hand-edited config.json can't inject
# markup or break the layout. Notebook content (recentFiles, openFiles,
# bookmarks, ...) is deliberately NOT embedded -- the page is served
# before auth, so it must not leak anything content-bearing.
_FONT_SCALES = {"small": 0.9, "medium": 1.0, "large": 1.15, "xlarge": 1.3}
_DEFAULT_SIDEBAR_WIDTH = 240
_DEFAULT_OUTLINE_WIDTH = 220
_MIN_PANE_WIDTH = 140
_MAX_PANE_WIDTH = 2000
_WALLPAPERS = ("none", "lines", "grid")
_WALLPAPER_COLORS = ("neutral", "blue", "green", "purple", "amber")
_WALLPAPER_INTENSITIES = ("subtle", "medium", "bold")
# The side-panel views the shell can boot into. Must equal the ids
# activity.js registers and the data-view hosts templates/index.html
# ships; tests/test_app.py enforces that. "graph" is an overlay, not a
# view, so it is deliberately absent.
_ACTIVE_VIEWS = ("explorer", "sessions", "pinned", "bookmarks", "recent",
                 "search", "ai")


def _read_public_config():
    """Return the stored config as a dict, or {} if missing/corrupt.

    Used for first-paint chrome values (callers must not embed
    content-bearing keys into the HTML -- see boot_state) and as the
    never-raising "load config.json" helper for the workspace routes."""
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        return {}
    return cfg if isinstance(cfg, dict) else {}


def _boot_workspaces():
    """First-paint workspace values for the shell.

    Only the active id and the caller's role are safe to paint on the login
    screen. The shell is served before auth, so when auth is on and no role
    is present we emit `workspace_id` and `role` alone: the name, the folder
    path and the list describe the machine's filesystem and must wait for an
    authenticated role. With auth off nothing is gated, so the full set is
    emitted. Values are re-sanitised here, like the rest of boot_state, so a
    hand-edited workspaces.json cannot inject markup.
    """
    items = load_workspaces()
    active = items[0]
    if has_request_context():
        wid = g.get("workspace_id")
        for entry in items:
            if entry["id"] == wid:
                active = entry
                break
    role = None
    if has_request_context() and auth_enabled():
        role = session.get("role")
    out = {"workspace_id": active["id"], "role": role}
    if auth_enabled() and not role:
        return out
    name = active["name"].strip()[:WORKSPACE_NAME_MAX] or WORKSPACE_DEFAULT_NAME
    out["workspace_name"] = name
    out["workspace_path"] = active["path"]
    out["workspaces"] = [
        {"id": entry["id"],
         "name": entry["name"].strip()[:WORKSPACE_NAME_MAX],
         "available": os.path.isdir(entry["path"])}
        for entry in items
    ]
    return out


def boot_state(cfg=None):
    """Sanitized subset of config used to render the first paint.

    Mirrors the fields app.js's applyConfig() touches. Every value is
    validated against an allowlist or clamped to a numeric range so a
    hand-edited config.json can never inject markup into the shell.
    """
    if cfg is None:
        cfg = _read_public_config()

    theme = cfg.get("theme", "auto")
    if theme not in ("auto", "light", "dark"):
        theme = "auto"

    font_name = cfg.get("fontSize", "medium")
    if font_name not in _FONT_SCALES:
        font_name = "medium"

    def _pane_width(key, default):
        try:
            w = float(cfg.get(key, default))
        except (TypeError, ValueError):
            return default
        if w != w or w in (float("inf"), float("-inf")):   # NaN / inf
            return default
        return int(max(_MIN_PANE_WIDTH, min(_MAX_PANE_WIDTH, w)))

    def _choice(key, allowed, default):
        val = cfg.get(key, default)
        return val if val in allowed else default

    sidebar_collapsed = bool(cfg.get("sidebarCollapsed"))
    outline_collapsed = bool(cfg.get("outlineCollapsed"))

    site_title = cfg.get("siteTitle", "Notebook")
    if not isinstance(site_title, str) or not site_title.strip():
        site_title = "Notebook"
    site_title = site_title.strip()[:60]

    wallpaper = _choice("wallpaper", _WALLPAPERS, "none")
    wallpaper_color = _choice("wallpaperColor", _WALLPAPER_COLORS, "neutral")
    wallpaper_intensity = _choice("wallpaperIntensity", _WALLPAPER_INTENSITIES, "subtle")
    wallpaper_scroll = _choice("wallpaperScroll", ("scroll", "fixed"), "scroll")

    # Tuple membership compares by ==, so a non-string (int/list/None) is
    # rejected without raising; anything not exactly a known view id falls
    # back to Explorer.
    active_view = cfg.get("activeView")
    if active_view not in _ACTIVE_VIEWS:
        active_view = "explorer"

    # The viewer-content classes are assembled here so the shell can render
    # them directly; keep them in the same shape app.js applies.
    wallpaper_classes = ["wallpaper-" + wallpaper]
    if wallpaper_color != "neutral":
        wallpaper_classes.append("wallpaper-color-" + wallpaper_color)
    wallpaper_classes.append("wallpaper-intensity-" + wallpaper_intensity)
    if wallpaper_scroll == "fixed":
        wallpaper_classes.append("wallpaper-fixed")

    return {
        "theme": theme,
        "site_title": site_title,
        "font_scale": _FONT_SCALES[font_name],
        # Collapsed panes collapse to 0 regardless of the saved width.
        "side_panel_width": 0 if sidebar_collapsed
                            else _pane_width("sidebarWidth", _DEFAULT_SIDEBAR_WIDTH),
        "outline_width": 0 if outline_collapsed
                         else _pane_width("outlineWidth", _DEFAULT_OUTLINE_WIDTH),
        "sidebar_collapsed": sidebar_collapsed,
        "outline_collapsed": outline_collapsed,
        "topbar_hidden": bool(cfg.get("hideTopbar")),
        "wallpaper_classes": " ".join(wallpaper_classes),
        "active_view": active_view,
        **_boot_workspaces(),
    }


def _render_index():
    """Render the SPA shell with the saved chrome pre-applied.

    Only embed the saved chrome when the requester is allowed to read the
    config: auth is off, or a session role is present. The page is served
    before auth, and an unauthenticated /api/config call returns 401, so
    for the login screen app.js falls back to DEFAULTS -- the server must
    paint those same defaults, or the first frame (saved values) would
    visibly reflow to defaults (and leak the saved preferences) when the
    401 lands. Authenticated requests get the real saved state so a
    reload is flash-free.
    """
    if auth_enabled() and not session.get("role"):
        # Login screen: defaults only. Theme is safe to keep (it is not a
        # secret and avoids a theme flip on the login screen).
        cfg = _read_public_config()
        state = boot_state({"theme": cfg.get("theme", "auto")})
    else:
        state = boot_state()
    return render_template("index.html", boot=state)


def _fold_legacy_workspace_state(cfg):
    """Merge legacy top-level content keys under workspaceState["default"].

    Idempotent: a workspace-aware blob has no legacy keys left, so this
    returns False. Runs on every config POST so a whole-blob write that
    still carries the old shape cannot strand those keys at the top level
    forever. The inbound top-level value wins over an existing default
    entry because the POST is the client's authoritative current state.
    """
    if not isinstance(cfg, dict):
        return False
    legacy = {key: cfg[key] for key in _WORKSPACE_SCOPED_CONFIG_KEYS
              if key in cfg}
    if not legacy:
        return False
    state = cfg.get("workspaceState")
    if not isinstance(state, dict):
        state = {}
    default = state.get(WORKSPACE_DEFAULT_ID)
    if not isinstance(default, dict):
        default = {}
    default.update(legacy)
    state[WORKSPACE_DEFAULT_ID] = default
    cfg["workspaceState"] = state
    for key in legacy:
        cfg.pop(key, None)
    return True


def _migrate_workspace_state(cfg):
    """Move legacy top-level content keys under workspaceState["default"].

    The one-shot startup migration, so clients never carry migration code.
    Mutates cfg in place and returns True when it changed. A blob that
    already has workspaceState is left alone: the client that wrote it is
    already workspace-aware.
    """
    if not isinstance(cfg, dict) or "workspaceState" in cfg:
        return False
    legacy = {key: cfg[key] for key in _WORKSPACE_SCOPED_CONFIG_KEYS
              if key in cfg}
    if not legacy:
        return False
    cfg["workspaceState"] = {WORKSPACE_DEFAULT_ID: legacy}
    for key in legacy:
        cfg.pop(key, None)
    return True


def _migrate_config_at_startup():
    """Run the one-shot workspace-state migration once at process start.

    Best effort: a read or write failure leaves the old shape for the next
    launch. Held under _CONFIG_LOCK so it cannot interleave with a
    concurrent POST and lose that writer's update; it deliberately does not
    run from a GET, which would make a read route write a server-owned file.
    """
    with _CONFIG_LOCK:
        cfg = _read_public_config()
        if not _migrate_workspace_state(cfg):
            return
        try:
            atomic_write(CONFIG_FILE, json.dumps(cfg, indent=2))
        except OSError:
            pass


@app.route("/api/config", methods=["GET"])
@read_login_required
def get_config():
    """Read config.json. The one-shot migration runs at startup, not here,
    so a GET never writes a server-owned file."""
    return jsonify(_read_public_config())


@app.route("/api/info", methods=["GET"])
@read_login_required
def info():
    """Read-only info used by the settings page. Returns the active
    workspace's data directory plus the config directory; both are already
    known to the user (they are the folders the server is operating on) and
    contain no secrets."""
    return jsonify({
        "data_dir": current_root(),
        "config_dir": CONFIG_DIR,
        "workspace": _active_workspace_id(),
    })


@app.route("/api/config", methods=["POST"])
@admin_required
def set_config():
    """Replace config.json with the POSTed blob.

    Held under _CONFIG_LOCK: set_workspace_state() and the startup migration
    read-modify-write the same file, and without the lock two writers can
    each read the old blob and silently lose the other's update. Legacy
    top-level content keys in the blob are folded under
    workspaceState["default"] first, so a whole-blob POST cannot strand
    them.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return err("Expected a JSON object body", 400)
    _fold_legacy_workspace_state(data)
    try:
        with _CONFIG_LOCK:
            atomic_write(CONFIG_FILE, json.dumps(data, indent=2))
    except OSError as exc:
        return err("Could not write config: %s" % exc, 500,
                   code="write_failed")
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- #
# Routes: workspaces
# --------------------------------------------------------------------------- #
@app.route("/api/workspaces", methods=["GET"])
@read_login_required
def list_workspaces():
    """List the registry; `active` is the caller's resolved workspace id."""
    items = load_workspaces()
    return jsonify({
        "workspaces": [_workspace_public(entry) for entry in items],
        "active": _active_workspace_id(),
    })


@app.route("/api/workspaces", methods=["POST"])
@workspace_admin_required
def add_workspace():
    """Register a folder as a new workspace.

    Body: {"name": "...", "path": "/abs/folder"}. Permission: admin when
    auth is enabled; when auth is disabled every route is open to the LAN,
    so the request must additionally come from a loopback address
    (workspace_admin_required). Registered paths are stored as the folder's
    absolute realpath, so later symlink changes cannot move the root out
    from under the path guards.
    """
    data, error = expect_json("name", "path", code="bad_body")
    if error:
        return error
    name = data.get("name")
    path = data.get("path")
    items = load_workspaces()
    problem = _workspace_name_problem(name, items)
    if problem:
        return err(problem[0], 400, code=problem[1])
    if len(items) >= WORKSPACE_MAX_COUNT:
        return err("At most %d workspaces are supported"
                   % WORKSPACE_MAX_COUNT, 400, code="too_many")
    problem = _workspace_path_problem(path, items)
    if problem:
        return err(problem[0], 400, code=problem[1])
    entry = {
        "id": _new_workspace_id(name.strip(), items),
        "name": name.strip(),
        "path": os.path.realpath(path.strip()),
    }
    items.append(entry)
    save_workspaces(items)
    return jsonify({"workspace": _workspace_public(entry)}), 201


@app.route("/api/workspaces/active", methods=["POST"])
@read_login_required
def set_active_workspace():
    """Switch this session to another workspace (a viewer may switch too).

    Body: {"id": "..."}. Stored in the signed session, so it lasts until
    logout; clients that cannot hold a session use the request header.
    """
    data, error = expect_json("id", code="bad_body")
    if error:
        return error
    wid = data.get("id")
    if not isinstance(wid, str) or not wid.strip():
        return err("id must be a non-empty string", 400, code="bad_body")
    wid = wid.strip()
    if resolve_workspace(wid) is None:
        return err("Unknown workspace", 404, code="unknown_workspace")
    session["workspace"] = wid
    return jsonify({"ok": True, "active": wid})


@app.route("/api/workspaces/<workspace_id>", methods=["PATCH"])
@workspace_admin_required
def rename_workspace(workspace_id):
    """Rename a workspace; the folder path is immutable.

    Body: {"name": "..."}. Changing the folder means removing the entry and
    adding it again, which keeps the stored realpath and the path guards in
    sync. The default entry may be renamed but never removed.
    """
    data, error = expect_json("name", code="bad_body")
    if error:
        return error
    items = load_workspaces()
    entry = next((e for e in items if e["id"] == workspace_id), None)
    if entry is None:
        return err("Unknown workspace", 404, code="unknown_workspace")
    name = data.get("name")
    problem = _workspace_name_problem(name, items, exclude_id=workspace_id)
    if problem:
        return err(problem[0], 400, code=problem[1])
    entry["name"] = name.strip()
    save_workspaces(items)
    return jsonify({"workspace": _workspace_public(entry)})


@app.route("/api/workspaces/<workspace_id>", methods=["DELETE"])
@workspace_admin_required
def remove_workspace(workspace_id):
    """Remove a workspace entry; never the folder or its notes.

    The default entry is not removable, and any session sitting on the
    removed workspace is cleared so the next request falls back to the
    default instead of 404ing on a stale id.
    """
    items = load_workspaces()
    entry = next((e for e in items if e["id"] == workspace_id), None)
    if entry is None:
        return err("Unknown workspace", 404, code="unknown_workspace")
    if workspace_id == WORKSPACE_DEFAULT_ID:
        return err("The default workspace can't be removed", 400,
                   code="default_not_removable")
    save_workspaces([e for e in items if e["id"] != workspace_id])
    if session.get("workspace") == workspace_id:
        session.pop("workspace", None)
    return jsonify({"ok": True})


@app.route("/api/workspace-state", methods=["POST"])
@workspace_admin_required
def set_workspace_state():
    """Merge per-workspace UI state into config.json.

    Body: {"id": "...", "state": {...}}. Stored under
    config.json -> workspaceState -> <id>; every other key, including the
    other workspaces' state, is preserved. `state` must be a JSON object and
    is capped at WORKSPACE_STATE_MAX_BYTES: this route takes an admin
    credential (cookie or bearer) and the whole blob is re-read at every
    boot. The merge runs under _CONFIG_LOCK so a concurrent set_config or
    startup migration cannot lose this update.

    Gated with workspace_admin_required rather than admin_required: it
    writes a server-owned file, so with auth off it must obey the same
    loopback rule as the registry mutations.
    """
    data, error = expect_json("id", "state", code="bad_body")
    if error:
        return error
    wid = data.get("id")
    state = data.get("state")
    if not isinstance(wid, str) or not wid.strip():
        return err("id must be a non-empty string", 400, code="bad_body")
    wid = wid.strip()
    if resolve_workspace(wid) is None:
        return err("Unknown workspace", 404, code="unknown_workspace")
    if not isinstance(state, dict):
        return err("state must be a JSON object", 400, code="bad_body")
    with _CONFIG_LOCK:
        cfg = _read_public_config()
        workspace_state = cfg.get("workspaceState")
        if not isinstance(workspace_state, dict):
            workspace_state = {}
        # Forward-compatibility guard: a page loaded before sessions shipped
        # posts the old key set, and replacing the entry would drop every
        # other session. A current client always sends both keys, so a
        # deliberate change, including a deletion, is never blocked.
        existing = workspace_state.get(wid)
        if isinstance(existing, dict) and "sessions" in existing:
            for key in ("sessions", "activeSessionId"):
                if key not in state:
                    state[key] = existing[key]
        encoded = json.dumps(state)
        if len(encoded.encode("utf-8")) > WORKSPACE_STATE_MAX_BYTES:
            return err("state exceeds %d bytes" % WORKSPACE_STATE_MAX_BYTES,
                       400, code="state_too_large")
        workspace_state[wid] = state
        cfg["workspaceState"] = workspace_state
        try:
            atomic_write(CONFIG_FILE, json.dumps(cfg, indent=2))
        except OSError as exc:
            return err("Could not write config: %s" % exc, 500,
                       code="write_failed")
    return jsonify({"ok": True, "id": wid})


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
    session.pop("workspace", None)
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

# ACP profiles (Agent Client Protocol agents spawned as subprocesses) live in
# their own hand-edited file -- deliberately NOT written through POST
# /api/ai/config, because a config blob any authed client can POST must never
# be able to choose a command to execute. See load_acp_configs().
ACP_FILE = os.path.join(CONFIG_DIR, "acp.json")

# Bounds on config/acp.json fields. The file is server-local and trusted, but
# a malformed entry should fail cleanly rather than spawn a runaway argv or
# build a multi-gigabyte prompt.
ACP_MAX_NAME_LEN = 60
ACP_MAX_COMMAND_LEN = 300
ACP_MAX_ARGS = 32
ACP_MAX_ARG_LEN = 1000
ACP_MAX_MODEL_LEN = 200
ACP_MAX_PROMPT_BYTES = 8 * 1024 * 1024

# Prepended to every ACP prompt. An ACP agent brings its own system prompt, so
# the notebook's system turn is not forwarded; this replaces it with the one
# fact the agent cannot discover cheaply -- where it is working. Kept to two
# sentences so it cannot drift into a second system prompt.
ACP_CONTEXT_PREAMBLE = (
    "Context: the current working directory is the user's Markdown notebook. "
    "Treat the request below as the current turn in an ongoing conversation.")

# Known ACP agents, keyed for config/acp.json's "agent" field. The command line
# lives HERE, server-side, for the same reason config/acp.json is not writable
# over HTTP: a config blob any client can POST must never choose a command to
# execute. Both the config file and the browser may only name a key; the argv
# is resolved from this table. "commands" is a preference list (an agent that
# renamed its adapter binary keeps working); "requires" names the wrapping CLI
# used for the "installed, but the ACP adapter is missing" hint. Sources:
# docs/research/acp-agent-commands.md.
ACP_KNOWN_AGENTS = (
    {"key": "opencode", "label": "opencode",
     "commands": ("opencode",), "args": ("acp",)},
    {"key": "claude", "label": "Claude Code",
     "commands": ("claude-agent-acp", "claude-code-acp"), "args": (),
     "requires": "claude",
     "hint": "npm install -g @agentclientprotocol/claude-agent-acp"},
    {"key": "codex", "label": "Codex",
     "commands": ("codex-acp",), "args": (),
     "requires": "codex",
     "hint": "npm install -g @agentclientprotocol/codex-acp"},
    {"key": "gemini", "label": "Gemini CLI",
     "commands": ("gemini",), "args": ("--acp",)},
    {"key": "goose", "label": "Goose",
     "commands": ("goose",), "args": ("acp",)},
    {"key": "cursor", "label": "Cursor Agent",
     "commands": ("cursor-agent", "agent"), "args": ("acp",)},
    {"key": "qwen", "label": "Qwen Code",
     "commands": ("qwen",), "args": ("--acp",)},
    {"key": "kimi", "label": "Kimi CLI",
     "commands": ("kimi",), "args": ("acp",)},
    {"key": "cline", "label": "Cline",
     "commands": ("cline",), "args": ("--acp",)},
    {"key": "openhands", "label": "OpenHands",
     "commands": ("openhands",), "args": ("acp",)},
    {"key": "auggie", "label": "Augment",
     "commands": ("auggie",), "args": ("--acp",)},
    {"key": "copilot", "label": "GitHub Copilot CLI",
     "commands": ("copilot",), "args": ("--acp",)},
    {"key": "kiro", "label": "Kiro",
     "commands": ("kiro-cli",), "args": ("acp",)},
)
# Fallback display label for the provider picker, which renders
# "<name> · <model>". A profile without a configured model gets this type tag
# instead. Kept in one place so the server's label and the browser's fallback
# can't drift.
ACP_LABEL = "ACP"

# Caps for the AI fetch tool so a single call can't balloon memory or hang
# the request thread. The fetch tool is admin-gated (like every /api/ai/*
# route) and single-user, but still bounded.
AI_FETCH_MAX_BYTES = 512 * 1024      # 512 KiB of body
AI_FETCH_TIMEOUT = 15                # seconds
AI_SEARXNG_TIMEOUT = 15              # seconds
AI_SEARXNG_MAX_RESULTS = 10          # cap for both search providers
AI_PROBE_TIMEOUT = 8                 # seconds for the /api/ai/probe ping

# Keyless fallback search provider (Yahoo's HTML results page), used when no
# SearXNG instance is configured or the configured one fails. No API key is
# needed, but the page is parsed, so a Yahoo markup change breaks it.
AI_FALLBACK_SEARCH_URL = "https://search.yahoo.com/search"
AI_FALLBACK_SEARCH_TIMEOUT = 20      # seconds
AI_SEARCH_MAX_BYTES = 1024 * 1024    # 1 MiB of body
# Yahoo serves a results-free shell to a plain agent UA, so the fallback must
# present a browser UA to get the result list back.
AI_FALLBACK_SEARCH_UA = ("Mozilla/5.0 (X11; Linux x86_64) "
                         "AppleWebKit/537.36 (KHTML, like Gecko) "
                         "Chrome/124.0 Safari/537.36")

# Result-page markup for the fallback provider: each result is one <li> whose
# <h3 class="title"> holds the title and whose href carries the target
# percent-encoded as RU=<encoded>/RK=.
AI_FALLBACK_TITLE_RE = re.compile(
    r'<h3[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>(.*?)</h3>', re.DOTALL)
AI_FALLBACK_LINK_RE = re.compile(r'RU=([^/"]+)/RK=')
AI_FALLBACK_PARA_RE = re.compile(r"<p[^>]*>(.*?)</p>", re.DOTALL)
AI_FALLBACK_TAG_RE = re.compile(r"<[^>]+>")
# Sponsored blocks are served as Bing click trackers inside the results list;
# they are irrelevant to the query and must not reach the model.
AI_FALLBACK_AD_RE = re.compile(r"^https?://(?:www\.)?bing\.com/aclick",
                               re.IGNORECASE)
AI_FALLBACK_LOOKBACK = 4096          # chars before a title to find its link
AI_FALLBACK_SNIPPET_WINDOW = 2048    # chars after a title to find a snippet
AI_FALLBACK_MAX_TITLE_TAGS = 200     # guards the non-greedy title regex
AI_FALLBACK_TITLE_MAX = 300          # chars kept per result title
AI_FALLBACK_SNIPPET_MAX = 500        # chars kept per result snippet
AI_FALLBACK_URL_MAX = 2000           # same cap /api/ai/fetch applies

# A vision user turn may carry image_url parts. This per-message cap bounds
# vision token cost and request size; image parts are rejected on any other
# role (a provider only reads images from user turns).
AI_CHAT_MAX_IMAGE_PARTS = 8


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


def _saved_server_names(data):
    """Valid names of the saved ai.json servers, hashing only strings.

    A hand-edited file can carry a non-string name; a set comprehension over
    those would raise TypeError and take every AI route down with it.
    """
    names = set()
    for server in data.get("servers") or []:
        if (isinstance(server, dict)
                and isinstance(server.get("name"), str)):
            names.add(server["name"])
    return names


def _acp_known_agent(key):
    """Return the allowlist entry for `key`, or None when unknown."""
    for entry in ACP_KNOWN_AGENTS:
        if entry["key"] == key:
            return entry
    return None


def _acp_agent_command(entry):
    """Absolute path of the first command in the entry's list that exists.

    shutil.which only resolves a name against PATH -- it never executes
    anything -- so detection stays read-only. The resolved *path* is returned,
    not the bare name: PATH can change between loading the config and spawning
    the agent, and pinning the path the user was shown avoids a surprise later.
    Returns None when nothing in the list is installed.
    """
    for candidate in entry["commands"]:
        path = shutil.which(candidate)
        if path:
            return path
    return None


def _acp_profile_entries(data):
    """Raw profile objects from config/acp.json `data`, in file order.

    Three shapes are accepted: the canonical {"profiles": [...]}, a bare
    array, and the legacy single profile object. Anything else yields no
    entries rather than raising.
    """
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if "profiles" in data:
            profiles = data["profiles"]
            return profiles if isinstance(profiles, list) else []
        return [data]
    return []


def _validate_acp_profile(data, saved_names):
    """Validate one config/acp.json profile; None when the entry is invalid.

    Each entry is validated on its own and dropped on any violation, so one
    typo cannot disable every other profile. `saved_names` holds the names of
    the ai.json servers: an ACP name that collides with one would be a dead
    picker entry (ai_chat resolves the OpenAI profile first), so that entry
    is dropped and the API profile keeps the name.

    "agent" names an entry in ACP_KNOWN_AGENTS and is mutually exclusive with
    "command": the argv is then resolved from that table, so the file names an
    entry instead of carrying a command line. "command" stays as the escape
    hatch for an agent the table does not know. "model" is optional and names
    the agent's own model, applied after session/new.
    """
    if not isinstance(data, dict):
        return None

    name = data.get("name")
    if (not isinstance(name, str) or not name.strip()
            or len(name.strip()) > ACP_MAX_NAME_LEN):
        return None
    name = name.strip()

    agent = data.get("agent")
    if agent is not None and not isinstance(agent, str):
        return None
    agent = (agent or "").strip()

    command = data.get("command")
    if agent:
        # An allowlisted agent: resolve the executable from the table. Two
        # sources for the same argv would be an ambiguity waiting to bite.
        if command not in (None, ""):
            return None
        entry = _acp_known_agent(agent)
        if entry is None:
            return None
        resolved = _acp_agent_command(entry)
        if resolved is None:
            return None
        command = resolved
        clean_args = list(entry["args"])
    else:
        if (not isinstance(command, str) or not command.strip()
                or len(command.strip()) > ACP_MAX_COMMAND_LEN):
            return None
        command = command.strip()
        args = data.get("args", [])
        if args is None:
            args = []
        if not isinstance(args, list) or len(args) > ACP_MAX_ARGS:
            return None
        clean_args = []
        for arg in args:
            if not isinstance(arg, str) or len(arg) > ACP_MAX_ARG_LEN:
                return None
            clean_args.append(arg)

    cwd = data.get("cwd", "")
    if cwd is None:
        cwd = ""
    if not isinstance(cwd, str):
        return None

    env = data.get("env")
    if env is not None:
        if not isinstance(env, dict):
            return None
        clean_env = {}
        for key, value in env.items():
            if not isinstance(key, str) or not isinstance(value, str):
                return None
            clean_env[key] = value
        env = clean_env

    model = data.get("model")
    if model is None:
        model = ""
    if not isinstance(model, str):
        return None
    model = model.strip()
    if len(model) > ACP_MAX_MODEL_LEN:
        return None

    default = data.get("default", False)
    if not isinstance(default, bool):
        return None

    timeout = data.get("timeout")
    if timeout is not None:
        # bool is an int subclass; reject it explicitly as a timeout value.
        # json.load also accepts NaN/Infinity, so require a finite number --
        # math.isfinite is False for both, which "<= 0" alone would let pass.
        if (isinstance(timeout, bool) or not isinstance(timeout, (int, float))
                or not math.isfinite(timeout) or timeout <= 0):
            return None

    if name in saved_names:
        return None

    return {"name": name, "agent": agent, "command": command,
            "args": clean_args, "cwd": cwd, "env": env, "model": model,
            "default": default, "timeout": timeout}


def load_acp_configs():
    """Read the hand-edited config/acp.json and return its valid profiles.

    ACP profiles are configured only by editing this file, never through
    POST /api/ai/config (a client-POSTable blob must not pick a command to
    run). Invalid entries are dropped individually so a typo in one profile
    cannot disable the others; duplicate names keep the first entry. The file
    is read once, and the ai.json server-name set once, so validation of N
    profiles does not re-read the config per entry. Never raises: an unset,
    unreadable or malformed file yields [].
    """
    try:
        with open(ACP_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    saved_names = _saved_server_names(load_ai_config())
    profiles = []
    seen = set()
    for raw in _acp_profile_entries(data):
        profile = _validate_acp_profile(raw, saved_names)
        if profile is None or profile["name"] in seen:
            continue
        seen.add(profile["name"])
        profiles.append(profile)
    return profiles


def load_acp_config():
    """First valid ACP profile, or {} when none (compatibility wrapper)."""
    profiles = load_acp_configs()
    return profiles[0] if profiles else {}


def _acp_profile(name):
    """Return the valid ACP profile called `name`, or None when unconfigured."""
    for profile in load_acp_configs():
        if profile["name"] == name:
            return profile
    return None


def save_ai_config(data):
    """Persist the AI settings atomically (same temp+replace as auth.json).

    Unique temp name for the same concurrent-writer reason as save_auth.
    """
    tmp = "%s.%s.tmp" % (AI_FILE, _tmp_suffix())
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, AI_FILE)


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
    # replaceSecretFor names another (usually renamed) profile whose key
    # should carry over; the Edit flow uses it when the profile name
    # itself is changed.
    if api_key == "" and raw.get("replaceSecret"):
        stored = load_ai_config()
        wanted = raw.get("replaceSecretFor") or name
        for s in stored.get("servers") or []:
            if isinstance(s, dict) and s.get("name") == wanted:
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


def _detect_acp_agents():
    """Which known ACP agents this host can launch (read-only PATH lookup).

    Surfaced so the UI can show what is available and, when a wrapping CLI is
    installed but its ACP adapter is not, point at the adapter's install
    command. shutil.which only resolves a name against PATH; nothing is
    executed, so detection has no side effects.
    """
    found = []
    for entry in ACP_KNOWN_AGENTS:
        available = _acp_agent_command(entry) is not None
        item = {"key": entry["key"], "label": entry["label"],
                "available": available}
        if not available and entry.get("requires"):
            if shutil.which(entry["requires"]):
                item["adapterMissing"] = True
                item["hint"] = entry.get("hint", "")
        found.append(item)
    return found


def _public_acp_configs(resolved_default):
    """Browser-safe view of every ACP profile, in file order.

    Only the name, the model label, the allowlist key and the resolved
    default flag are exposed. command / args / env / cwd / timeout stay
    server-side: the browser never needs them and must not be able to read a
    command line. The key is not a secret -- it names an entry in
    ACP_KNOWN_AGENTS -- and the UI needs it to show which agent is selected.
    A profile without a configured model carries the fixed ACP_LABEL so the
    picker (which shows "name · model") always has a non-empty suffix.

    `default` is computed from the resolved provider name, not from the raw
    file flag, so a default chosen in the settings UI wins without the server
    ever rewriting config/acp.json. `hasModel` distinguishes a configured
    model from the ACP_LABEL fallback, so the settings panel does not present
    the fallback as a real model id.
    """
    return [{"name": profile["name"],
             "model": profile["model"] or ACP_LABEL,
             "hasModel": bool(profile["model"]),
             "agent": profile.get("agent", ""),
             "default": profile["name"] == resolved_default}
            for profile in load_acp_configs()]


def _resolve_default_provider(data):
    """Name of the provider the UI should select by default.

    An ai.json "default" wins when it names a saved server or an ACP profile,
    so "Make default" in the settings UI always takes effect. Otherwise the
    first ACP profile flagged default:true keeps the legacy behaviour, and ""
    lets the frontend fall back to the first entry.
    """
    stored = data.get("default", "")
    server_names = _saved_server_names(data)
    profiles = load_acp_configs()
    if (isinstance(stored, str) and stored
            and (stored in server_names
                 or any(p["name"] == stored for p in profiles))):
        return stored
    for profile in profiles:
        if profile["default"]:
            return profile["name"]
    return ""


def _public_ai_config():
    """Config safe for the browser: booleans instead of secrets.

    The stored api_key is NEVER echoed back -- the settings UI re-sends
    replaceSecret to keep it, so a stolen config response can't be replayed.
    "acp" is the first ACP profile, kept for older clients; "acps" is the
    full list.
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
    # customPrompt is a GLOBAL setting (used by whichever provider is
    # active), stored outside the server list. searxngUrl is the optional
    # SearXNG instance the search tool queries; it is not a secret but is
    # kept server-side so the browser never needs to know the LAN address.
    custom = data.get("custom_prompt")
    searx = data.get("searxng_url")
    default = _resolve_default_provider(data)
    acps = _public_acp_configs(default)
    return {"servers": servers, "default": default,
            "customPrompt": custom if isinstance(custom, str) else "",
            "searxngUrl": searx if isinstance(searx, str) else "",
            "acp": acps[0] if acps else None,
            "acps": acps,
            "acpAgents": _detect_acp_agents()}


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
    ...], "default": "<name>", "customPrompt": "<global instructions>",
    "searxngUrl": "<optional SearXNG instance>"}.
    The list replaces the stored one but entries whose apiKey is "" +
    replaceSecret:true carry over the previously stored key, so the UI can
    round-trip profiles without echoing secrets back through the browser.
    customPrompt is the global assistant instruction text (applies to
    whichever provider is active), stored outside the server list and
    preserved when the field is omitted (older clients). searxngUrl is the
    optional SearXNG instance the search tool queries; it is preserved when
    omitted and cleared when sent as "".
    `default` may name a saved server or an ACP profile, and a server name
    that collides with an ACP profile is rejected so routing stays
    unambiguous. config/acp.json itself is never written here.
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
    custom_prompt = data.get("customPrompt")
    if custom_prompt is None:
        # Field absent -> keep whatever is stored (round-trip safety).
        custom_prompt = load_ai_config().get("custom_prompt", "")
    if not isinstance(custom_prompt, str):
        return err("customPrompt must be a string", 400)
    if len(custom_prompt) > 8000:
        return err("customPrompt is longer than 8000 chars", 400)
    custom_prompt = custom_prompt.strip()
    searxng_url = data.get("searxngUrl")
    if searxng_url is None:
        # Field absent -> keep whatever is stored (round-trip safety).
        searxng_url = load_ai_config().get("searxng_url", "")
    if not isinstance(searxng_url, str):
        return err("searxngUrl must be a string", 400)
    searxng_url = searxng_url.strip()
    if searxng_url and not searxng_url.lower().startswith(("http://", "https://")):
        return err("searxngUrl must be an http(s) URL", 400)
    if len(searxng_url) > 300:
        return err("searxngUrl is longer than 300 chars", 400)
    searxng_url = searxng_url.rstrip("/")
    # A posted server that reuses an ACP profile's name would make routing
    # ambiguous; the file stays hand-edited, so reject the save instead of
    # creating the collision.
    acp_names = {p["name"] for p in load_acp_configs()}
    cleaned = []
    seen = set()
    for i, raw in enumerate(servers_in):
        try:
            clean = _sanitize_server(raw, i)
        except ValueError as exc:
            return err(str(exc), 400)
        if clean["name"] in acp_names:
            return err("servers[%d].name collides with an ACP profile" % i, 400)
        if any(s["name"] == clean["name"] for s in cleaned):
            return err("duplicate server name: %s" % clean["name"], 400)
        seen.add(clean["name"])
        cleaned.append(clean)
    if default and default not in seen and default not in acp_names:
        return err("default is not a saved server or ACP profile", 400)
    try:
        save_ai_config({"servers": cleaned, "default": default,
                        "custom_prompt": custom_prompt,
                        "searxng_url": searxng_url})
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
        with urllib.request.urlopen(req, timeout=AI_PROBE_TIMEOUT) as resp:
            return jsonify({"ok": True, "status": resp.status})
    except urllib.error.HTTPError as exc:
        # The endpoint lives and answered -- that's what "probe" asks.
        return jsonify({"ok": True, "status": exc.code})
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 200


def _rebuild_chat_message(m):
    """Validate one chat message and rebuild it to strictly {role, content}.

    Returns (message, None) on success or (None, error_message). Only
    {role, content} survives, so any other client-supplied per-message
    key is dropped and cannot leak upstream. content is either a string
    (backward compatible) or a non-empty list of content parts:
    {"type": "text", "text": <str>} or
    {"type": "image_url", "image_url": {"url": "data:image/..."}}.
    Image parts are allowed only on user messages, at most
    AI_CHAT_MAX_IMAGE_PARTS per message; anything else is rejected.
    """
    if not isinstance(m, dict):
        return None, "each message must be an object"
    role = m.get("role")
    if role not in ("system", "user", "assistant"):
        return None, "role must be system|user|assistant"
    content = m.get("content")
    if isinstance(content, str):
        return {"role": role, "content": content}, None
    if not isinstance(content, list) or not content:
        return None, "content must be a string or a non-empty list of parts"
    rebuilt = []
    image_parts = 0
    for part in content:
        if not isinstance(part, dict):
            return None, "each content part must be an object"
        ptype = part.get("type")
        if ptype == "text":
            text = part.get("text")
            if not isinstance(text, str):
                return None, "text part needs a string text"
            rebuilt.append({"type": "text", "text": text})
        elif ptype == "image_url":
            if role != "user":
                return None, "image_url parts are allowed only on user messages"
            image_url = part.get("image_url")
            url = image_url.get("url") if isinstance(image_url, dict) else None
            if not isinstance(url, str) or not url.startswith("data:image/"):
                return None, "image_url part needs a data:image/ url"
            image_parts += 1
            if image_parts > AI_CHAT_MAX_IMAGE_PARTS:
                return None, ("at most %d image_url parts per message"
                              % AI_CHAT_MAX_IMAGE_PARTS)
            rebuilt.append({"type": "image_url", "image_url": {"url": url}})
        else:
            return None, "unsupported content part type"
    return {"role": role, "content": rebuilt}, None


def _validate_chat_messages(messages, drop_system=False):
    """Validate a chat message list, returning (clean, error_response).

    Shared by the OpenAI relay and the ACP branch so both enforce the exact
    same shape and error strings. On success returns (list, None); any
    violation returns (None, error_response). With drop_system the caller
    keeps only user/assistant turns (ACP: the agent brings its own prompt).
    """
    if not isinstance(messages, list) or not messages:
        return None, err("messages must be a non-empty list", 400)
    clean = []
    for m in messages:
        built, problem = _rebuild_chat_message(m)
        if problem is not None:
            return None, err("messages entries must be "
                             "{role: system|user|assistant, content: str or "
                             "content-part list}: %s" % problem, 400)
        if drop_system and built["role"] == "system":
            continue
        clean.append(built)
    return clean, None


def _flatten_acp_prompt(messages):
    """Flatten validated chat messages into one ACP prompt string.

    ACP has no multi-turn message array -- one prompt starts the agent's own
    turn -- so the browser's re-uploaded transcript is serialized as
    "User: ..." / "Assistant: ..." blocks joined by blank lines, in order.
    System messages are dropped by the caller (the agent brings its own
    system prompt). Image parts never reach here (rejected earlier).
    """
    labels = {"user": "User", "assistant": "Assistant"}
    blocks = []
    for m in messages:
        content = m.get("content")
        if isinstance(content, list):
            text = "".join(part.get("text", "") for part in content
                           if part.get("type") == "text")
        elif isinstance(content, str):
            text = content
        else:
            text = ""
        blocks.append("%s: %s" % (labels.get(m.get("role"), "User"), text))
    return "\n\n".join(blocks)


def _acp_context_preamble(workspace_id=None):
    """Rebuild the context the dropped system turn used to carry.

    The ACP branch drops the notebook's system message (the agent has its own),
    which also drops the global custom prompt and the open-file hint that the
    single-model path sends. Both are recoverable from server state -- the
    custom prompt from config/ai.json, the open note from config/config.json --
    so rebuild them here instead of teaching the browser a second format. The
    result is prepended to the flattened transcript on every turn, so it is
    never duplicated into the conversation.

    The open note is per workspace: workspaceState["<id>"].activeFile, falling
    back to the top-level activeFile written by clients that predate
    workspaces. `workspace_id` defaults to the default workspace.
    """
    lines = [ACP_CONTEXT_PREAMBLE]
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        cfg = {}
    if not isinstance(cfg, dict):
        cfg = {}
    active = None
    scoped = cfg.get("workspaceState")
    if isinstance(scoped, dict):
        state = scoped.get(workspace_id or WORKSPACE_DEFAULT_ID)
        if isinstance(state, dict):
            active = state.get("activeFile")
    if not isinstance(active, str) or not active.strip():
        active = cfg.get("activeFile")
    if isinstance(active, str) and active.strip():
        lines.append("The note currently open: %s" % active.strip())
    custom = load_ai_config().get("custom_prompt")
    if isinstance(custom, str) and custom.strip():
        lines.append(custom.strip())
    return "\n\n".join(lines)


def _acp_sse_error(message):
    """A one-frame SSE error using the OpenAI relay's error convention.

    Used when ACP cannot even start (the SDK is not installed), so the
    browser's onmessage path shows it inline exactly like an upstream failure.
    """
    def frames():
        yield "event: error\ndata: %s\n\n" % json.dumps(
            {"error": True, "status": 0, "message": message})

    return Response(frames(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-store",
                             "X-Accel-Buffering": "no"})


def _acp_chat_response(acp, data):
    """Stream one ACP turn as SSE: one agent process per request.

    The ACP profile lives in config/acp.json (never in the ai.json server
    list), so this branch is reached when the POSTed server name matches an
    ACP profile. Message validation is shared with the OpenAI path; system
    messages are then dropped (the agent has its own prompt) and image parts
    are rejected (no vision over ACP in v1). The surviving transcript is
    flattened to one prompt string. The profile's configured model, when set,
    is applied by acp_client after session/new. Each SSE event mirrors the
    OpenAI relay's framing so static/js/api.js parses it unchanged: text rides
    the OpenAI delta shape, done is `data: [DONE]`, and a failure is the same
    `event: error` payload. The ACP client module is imported lazily so a
    missing agent-client-protocol package disables only ACP, never the server.
    """
    clean_messages, error = _validate_chat_messages(
        data.get("messages"), drop_system=True)
    if error:
        return error
    if not clean_messages:
        return err("ACP profiles require at least one user or assistant "
                   "message", 400)
    for m in clean_messages:
        content = m["content"]
        if isinstance(content, list) and any(
                part.get("type") == "image_url" for part in content):
            return err("ACP profiles do not support image attachments", 400)

    # The optional body workspace id selects the root the agent runs in and
    # the workspace whose open note goes into the preamble. An unknown id is
    # an error, not a silent fallback: the agent would otherwise work in a
    # different folder than the client thinks.
    requested = data.get("workspace")
    if requested is not None and not isinstance(requested, str):
        return err("workspace must be a string", 400)
    requested = (requested or "").strip()
    if requested:
        entry = resolve_workspace(requested)
        if entry is None:
            return err("Unknown workspace", 404, code="unknown_workspace")
        workspace_id = entry["id"]
        root = entry["path"]
    else:
        workspace_id = _active_workspace_id()
        root = current_root()

    prompt = (_acp_context_preamble(workspace_id) + "\n\n"
              + _flatten_acp_prompt(clean_messages))
    if len(prompt.encode("utf-8")) > ACP_MAX_PROMPT_BYTES:
        return err("ACP prompt exceeds %d bytes" % ACP_MAX_PROMPT_BYTES, 400)

    try:
        import acp_client
    except ImportError:
        return _acp_sse_error("ACP support is unavailable: the "
                              "agent-client-protocol package is not installed")

    command = acp["command"]
    args = list(acp.get("args") or [])
    # The agent runs with the configured cwd, else the active workspace root,
    # so a relative-path tool call resolves against that notebook by default.
    cwd = acp.get("cwd") or root
    env = acp.get("env")
    model = acp.get("model") or None
    timeout = acp.get("timeout")

    def pump():
        try:
            for event in acp_client.run_turn(
                    command, args=args, cwd=cwd, env=env, model=model,
                    prompt=prompt, timeout=timeout, keepalive=True):
                etype = event.get("type")
                if etype == "text":
                    yield "data: %s\n\n" % json.dumps(
                        {"choices": [{"delta": {"content": event["text"]}}]},
                        separators=(",", ":"))
                elif etype == "trace":
                    # A tool the agent started. Carried as a namespaced frame
                    # the OpenAI-shaped parser ignores; the panel renders it as
                    # a trace line so a long multi-step turn shows activity.
                    yield "data: %s\n\n" % json.dumps(
                        {"acp": "trace", "text": event["text"]},
                        separators=(",", ":"))
                elif etype == "done":
                    yield "data: [DONE]\n\n"
                    return
                elif etype == "error":
                    yield "event: error\ndata: %s\n\n" % json.dumps(
                        {"error": True, "status": 0,
                         "message": event["message"]})
                    return
                else:
                    # Idle poll: a keep-alive comment so a long silent agent
                    # turn (multi-step tool run) is not dropped as a timeout.
                    yield ": ping\n\n"
        except GeneratorExit:
            # Browser closed mid-stream; the runner generator is closed too,
            # which cancels the turn and runs the SDK's subprocess kill
            # ladder. Mirror the OpenAI relay's re-raise.
            raise

    return Response(pump(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-store",
                             "X-Accel-Buffering": "no"})


@app.route("/api/ai/chat", methods=["POST"])
@admin_required
def ai_chat():
    """Stream a chat completion through the saved upstream as SSE.

    Body: {"server": "<profile name>", "messages": [{role, content}, ...],
    "workspace": "<workspace id>" (optional, ACP only)}.
    A message's content is a string, or a list of content parts
    ({"type":"text",...} / {"type":"image_url","image_url":{"url":
    "data:image/..."}}) so the side panel can send screenshots to a vision
    model; image parts are user-only, at most AI_CHAT_MAX_IMAGE_PARTS each.
    Every message is rebuilt to {role, content} before relaying, so no
    client key leaks upstream. The chosen profile's apiKey is attached
    server-side; the browser never sees it. The upstream SSE byte stream is
    relayed unmodified with Content-Type: text/event-stream (this endpoint
    IS the upstream body).

    The same route serves ACP profiles (config/acp.json): if the name is not
    an OpenAI server but matches an ACP profile, the turn is driven through
    acp_client and streamed in the same SSE envelope.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}
    stored = _saved_server(data.get("server", ""))
    if stored is None:
        profile = _acp_profile(data.get("server", ""))
        if profile is not None:
            return _acp_chat_response(profile, data)
        return err("Unknown or missing server", 400)
    url = _chat_url(stored.get("base_url", ""))
    if not url:
        return err("Server has no baseUrl configured", 400)
    messages = data.get("messages")
    clean_messages, error = _validate_chat_messages(messages)
    if error:
        return error
    # White-list the upstream payload: the browser's "server" selector and
    # any extra keys must not leak through to the provider.
    payload_body = {"model": stored.get("model") or "default",
                    "messages": clean_messages, "stream": True}
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


def _http_get(url, timeout, max_bytes, headers=None):
    """GET `url` and return (content_type, body, truncated).

    Reads at most max_bytes + 1 bytes, so truncation is detected without
    trusting Content-Length; body is capped at max_bytes. Transport errors
    (HTTPError/URLError/OSError/ValueError) propagate to the caller.
    """
    req = urllib.request.Request(url, method="GET", headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = resp.headers.get("Content-Type", "")
            body = resp.read(max_bytes + 1)
    except http.client.HTTPException as exc:
        # A malformed status line is a provider failure, not a server bug.
        raise ValueError("upstream sent a malformed response: %s" % exc)
    truncated = len(body) > max_bytes
    return ctype, body[:max_bytes], truncated


@app.route("/api/ai/fetch", methods=["POST"])
@admin_required
def ai_fetch():
    """Fetch a URL server-side for the AI assistant's fetch tool.

    Body: {"url": "<http(s) url>"}. The browser can't fetch arbitrary
    origins (CORS), so the server does it. The response is capped at
    AI_FETCH_MAX_BYTES and the request times out after AI_FETCH_TIMEOUT.
    Only http(s) is allowed (no file://, no localhost/private ranges are
    blocked -- this is a single-user, admin-gated tool, but the scheme
    check keeps the obvious foot-guns out). The body is returned as text
    with a content-type hint so the model can decide how to read it.
    """
    data, error = expect_json("url")
    if error:
        return error
    url = data.get("url", "")
    if not isinstance(url, str) or not url.strip():
        return err("url must be a non-empty string", 400)
    url = url.strip()
    if not url.lower().startswith(("http://", "https://")):
        return err("url must be an http(s) URL", 400)
    if len(url) > 2000:
        return err("url is longer than 2000 chars", 400)
    headers = {
        "User-Agent": "notebook-ai-fetch/1.0",
        "Accept": "text/html,text/plain,application/json,text/markdown,*/*",
    }
    try:
        ctype, body, truncated = _http_get(url, AI_FETCH_TIMEOUT,
                                           AI_FETCH_MAX_BYTES, headers)
    except urllib.error.HTTPError as exc:
        return err("fetch failed: HTTP %d" % exc.code, 502)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return err("fetch failed: %s" % exc, 502)
    text = body.decode("utf-8", "replace")
    return jsonify({
        "url": url,
        "contentType": ctype,
        "truncated": truncated,
        "content": text,
    })


def _provider_error(exc):
    """One-line description of a failed search provider call."""
    if isinstance(exc, urllib.error.HTTPError):
        return "HTTP %d" % exc.code
    return (str(exc) or exc.__class__.__name__)[:200]


def _searxng_search(q):
    """Query the configured SearXNG instance; raise on any failure.

    Uses the instance's JSON output format and returns at most
    AI_SEARXNG_MAX_RESULTS {title, url, snippet} dicts.
    """
    base = load_ai_config().get("searxng_url")
    base = base.strip() if isinstance(base, str) else ""
    if not base:
        raise ValueError("no instance configured")
    if not base.lower().startswith(("http://", "https://")):
        raise ValueError("instance URL is not http(s)")
    url = (base.rstrip("/") + "/search?q=" + urllib.parse.quote(q)
           + "&format=json")
    headers = {
        "User-Agent": "notebook-ai-search/1.0",
        "Accept": "application/json",
    }
    _, raw, _ = _http_get(url, AI_SEARXNG_TIMEOUT, AI_SEARCH_MAX_BYTES,
                          headers)
    try:
        parsed = json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        raise ValueError("search returned non-JSON")
    if not isinstance(parsed, dict) or not isinstance(
            parsed.get("results"), list):
        raise ValueError("search returned an unexpected JSON shape")
    results = []
    for r in parsed["results"][:AI_SEARXNG_MAX_RESULTS]:
        if not isinstance(r, dict):
            continue
        results.append({
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "snippet": r.get("content", ""),
        })
    return results


def _html_text(fragment):
    """Plain text from an HTML fragment: tags stripped, entities unescaped,
    whitespace collapsed."""
    return " ".join(
        html.unescape(AI_FALLBACK_TAG_RE.sub(" ", fragment)).split())


def _yahoo_search(q):
    """Query the keyless Yahoo results page; raise on any failure.

    Parses the result list out of the raw HTML: no feed, no API key. Returns
    at most AI_SEARXNG_MAX_RESULTS {title, url, snippet} dicts. A page with
    no result titles is a successful empty result, not an error.
    """
    url = AI_FALLBACK_SEARCH_URL + "?p=" + urllib.parse.quote(q)
    headers = {
        "User-Agent": AI_FALLBACK_SEARCH_UA,
        "Accept": "text/html,application/xhtml+xml",
    }
    _, raw, truncated = _http_get(url, AI_FALLBACK_SEARCH_TIMEOUT,
                                  AI_SEARCH_MAX_BYTES, headers)
    if truncated:
        raise ValueError("results page is larger than %d bytes"
                         % AI_SEARCH_MAX_BYTES)
    page = raw.decode("utf-8", "replace")
    # The title regex scans to end-of-string for an unclosed <h3, so a page
    # with many openers would stall the server; real pages carry under ten.
    if page.count("<h3") > AI_FALLBACK_MAX_TITLE_TAGS:
        raise ValueError("results page has too many title tags")
    results = []
    for match in AI_FALLBACK_TITLE_RE.finditer(page):
        # The target sits percent-encoded in the anchor's href as RU=<url>/RK=.
        # Nav chrome contributes its own RU= links, so pair by look-back: the
        # nearest one before the title belongs to it.
        window = page[max(0, match.start() - AI_FALLBACK_LOOKBACK):
                      match.start()]
        links = AI_FALLBACK_LINK_RE.findall(window)
        if not links:
            continue
        target = urllib.parse.unquote(html.unescape(links[-1]))
        if not target.lower().startswith(("http://", "https://")):
            continue
        if AI_FALLBACK_AD_RE.match(target):
            continue
        if len(target) > AI_FALLBACK_URL_MAX:
            continue
        title = _html_text(match.group(1))[:AI_FALLBACK_TITLE_MAX]
        if not title:
            continue
        snippet = ""
        para = AI_FALLBACK_PARA_RE.search(
            page, match.end(),
            min(len(page), match.end() + AI_FALLBACK_SNIPPET_WINDOW))
        if para:
            snippet = _html_text(para.group(1))[:AI_FALLBACK_SNIPPET_MAX]
        results.append({"title": title, "url": target, "snippet": snippet})
        if len(results) >= AI_SEARXNG_MAX_RESULTS:
            break
    return results


@app.route("/api/ai/search", methods=["POST"])
@admin_required
def ai_search():
    """Search the web for the AI assistant.

    Body: {"q": "<query>"}. SearXNG is the preferred provider: when a
    searxngUrl is configured it is queried first, and any failure falls
    through to the keyless Yahoo results-page fallback. The top
    AI_SEARXNG_MAX_RESULTS results come back as {title, url, snippet},
    tagged with the engine that answered.
    """
    data, error = expect_json("q")
    if error:
        return error
    q = data.get("q", "")
    if not isinstance(q, str) or not q.strip():
        return err("q must be a non-empty string", 400)
    q = q.strip()
    if len(q) > 500:
        return err("q is longer than 500 chars", 400)
    base = load_ai_config().get("searxng_url")
    base = base.strip() if isinstance(base, str) else ""
    errors = []
    if base:
        try:
            results = _searxng_search(q)
            return jsonify({"query": q, "engine": "searxng",
                            "results": results})
        except (urllib.error.URLError, OSError, ValueError) as exc:
            errors.append("searxng: %s" % _provider_error(exc))
    try:
        results = _yahoo_search(q)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        errors.append("fallback: %s" % _provider_error(exc))
        return err("search failed: " + "; ".join(errors), 502)
    return jsonify({"query": q, "engine": "yahoo", "results": results})


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
    error = _unknown_workspace_response()
    if error:
        return error
    root = current_root()
    return jsonify({"tree": build_tree(root, root)})


@app.route("/api/ls", methods=["GET"])
@read_login_required
def ls_dir():
    """Non-recursive listing of a single folder.

    Unlike /api/tree this shows EVERY file type (attachments included),
    carries size + mtime, and never descends into subfolders -- so an
    agent can inspect one directory without pulling the whole tree.
    Hidden entries (dotfiles, __pycache__) are skipped, matching the
    tree. Empty path lists the active workspace root.
    """
    error = _unknown_workspace_response()
    if error:
        return error
    root = current_root()
    rel = request.args.get("path", "").strip()
    if rel in ("", "."):
        abs_dir = os.path.realpath(root)
        rel_out = ""
    else:
        abs_dir = safe_path(rel, root)
        if abs_dir is None:
            return err("Invalid path", 400)
        rel_out = rel_from(abs_dir, root)
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
    error = _unknown_workspace_response()
    if error:
        return error
    rel = request.args.get("path", "").strip()
    abs_path = safe_path(rel, current_root())
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
    error = _unknown_workspace_response()
    if error:
        return error
    data, error = expect_json("path", "content")
    if error:
        return error
    rel = data["path"]
    content = data["content"]
    if not isinstance(content, str):
        return err("content must be a string", 400)
    abs_path = safe_path(rel, current_root())
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
    error = _unknown_workspace_response()
    if error:
        return error
    data, error = expect_json("path", "content")
    if error:
        return error
    rel = data["path"]
    content = data["content"]
    if not isinstance(content, str):
        return err("content must be a string", 400)
    abs_path = safe_path(rel, current_root())
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
    error = _unknown_workspace_response()
    if error:
        return error
    data, error = expect_json("path", "edits")
    if error:
        return error
    rel = data["path"]
    edits = data["edits"]
    if not isinstance(edits, list) or not edits:
        return err("edits must be a non-empty list of ops", 400)
    abs_path = safe_path(rel, current_root())
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
    error = _unknown_workspace_response()
    if error:
        return error
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
    abs_path = safe_path(rel, current_root())
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
    error = _unknown_workspace_response()
    if error:
        return error
    data, error = expect_json("from", "to")
    if error:
        return error
    on_conflict = data.get("onConflict", "error")
    if on_conflict not in ("error", "skip", "overwrite"):
        return err("onConflict must be 'error', 'skip' or 'overwrite'", 400)
    src = safe_path(data["from"], current_root())
    dst = safe_path(data["to"], current_root())
    if src is None or dst is None:
        return err("Invalid path", 400)
    # The notebook root itself is not a movable object: renaming it away
    # (or unlinking it as an overwrite "conflict") would take the whole
    # data tree with it. Same path on both ends is a no-op at best and a
    # self-clobber at worst (overwrite removes the destination -- which
    # IS the source -- before the copy), so reject it outright.
    norm_data = os.path.normpath(current_root())
    if _resolves_to_root(src, norm_data) or _resolves_to_root(dst, norm_data):
        return err("Invalid path", 400)
    # Two spellings can name one entry through a symlinked parent; only the
    # case-only rename below may get past this guard.
    if src == dst or (_same_entry(src, dst)
                      and not _same_file_ignoring_case(src, dst)):
        return err("Source and destination are the same path", 400)
    if not os.path.exists(src):
        return err("Source not found", 404)
    src_is_dir = os.path.isdir(src) and not os.path.islink(src)

    # A case-only rename names the source under another spelling; rename in
    # place rather than take the conflict branch, which would delete it.
    if _same_file_ignoring_case(src, dst):
        try:
            os.rename(src, dst)
        except OSError as exc:
            return err("Could not move: %s" % exc, 500)
        return jsonify({"from": data["from"], "to": data["to"]})

    # A destination inside the source is refused before the conflict branch
    # can delete the subtree that the failing rename would leave destroyed.
    if src_is_dir and _is_within(dst, src):
        return err("Cannot move a folder into itself", 400)

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
    if not src_is_dir and not os.path.islink(src):
        # Symlinked sources go straight to rename() below: link() would
        # hardlink the link's TARGET and unlink would then drop the
        # user's symlink, silently changing what the notebook points at.
        # rename() moves the link itself (the mv(1) behaviour).
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
    error = _unknown_workspace_response()
    if error:
        return error
    data, error = expect_json("from", "to")
    if error:
        return error
    on_conflict = data.get("onConflict", "error")
    if on_conflict not in ("error", "skip", "overwrite"):
        return err("onConflict must be 'error', 'skip' or 'overwrite'", 400)
    src = safe_path(data["from"], current_root())
    dst = safe_path(data["to"], current_root())
    if src is None or dst is None:
        return err("Invalid path", 400)
    # Same guards as /api/move: the notebook root is not a copyable/
    # replaceable object, and copying onto the source itself would (with
    # overwrite) delete the file before copying it -- silent data loss.
    norm_data = os.path.normpath(current_root())
    if _resolves_to_root(src, norm_data) or _resolves_to_root(dst, norm_data):
        return err("Invalid path", 400)
    # Two spellings can name one entry through a symlinked parent.
    if src == dst or _same_entry(src, dst):
        return err("Source and destination are the same path", 400)
    if not os.path.exists(src):
        return err("Source not found", 404)
    src_is_dir = os.path.isdir(src) and not os.path.islink(src)

    # A copy onto itself under another case is refused untouched: the
    # conflict branch would delete the source before copying it.
    if _same_file_ignoring_case(src, dst):
        return err("Source and destination are the same path", 400)

    # A destination inside the source is refused before the conflict branch
    # can delete the subtree that the failing copy would leave destroyed.
    # A symlinked folder source is included: it cannot be copied as a file.
    if os.path.isdir(src) and _is_within(dst, src):
        return err("Cannot copy a folder into itself", 400)

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
    error = _unknown_workspace_response()
    if error:
        return error
    data, error = expect_json("path")
    if error:
        return error
    abs_path = safe_path(data["path"], current_root())
    if abs_path is None or abs_path == os.path.normpath(current_root()):
        return err("Invalid path", 400)
    if not os.path.exists(abs_path):
        return err("Not found", 404)
    try:
        _remove_path(abs_path)
    except OSError as exc:
        return err("Could not delete: %s" % exc, 500)
    return jsonify({"path": data["path"]})


# --------------------------------------------------------------------------- #
# Routes: search
# --------------------------------------------------------------------------- #
class _ScanBudget:
    """Wall-clock deadline for one whole-workspace scan.

    Built once per request from ``SCAN_TIMEOUT_SECONDS`` and threaded into
    every walk and file loop of that scan. ``seconds=None`` means "no
    limit": a direct call to a scan helper outside a request still works
    exactly as it did before the deadline existed.

    ``tripped`` records that some loop actually stopped because of the
    deadline, which lets a caller tell "the walk finished" from "the walk
    stopped" without catching an exception out of a generator. Reading a
    single enormous file cannot be interrupted mid-read: the checks happen
    before each file open and between line blocks, so one huge file can
    overrun the deadline by one file's read time and no more.
    """

    def __init__(self, seconds=None):
        self.tripped = False
        self._deadline = (
            None if seconds is None else time.monotonic() + seconds
        )

    def expired(self):
        """True once the deadline has passed; always false with no limit."""
        if self._deadline is None:
            return False
        return time.monotonic() >= self._deadline


def _scan_expired(budget):
    """True when `budget` exists and has run out; latches budget.tripped."""
    if budget is None or not budget.expired():
        return False
    budget.tripped = True
    return True


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


def _iter_search_targets(scoped, glob_pat, root=None, budget=None):
    """Yield (relative, absolute) for every .md file the search should scan.

    `root` is the active workspace root; it defaults to DATA_DIR for direct
    calls outside a request. `budget` is the per-request ``_ScanBudget``;
    when it expires the walk returns cleanly and the caller reads
    ``budget.tripped`` to learn that the listing is incomplete. No
    exception is raised, so a caller that ignores the budget still gets a
    usable (short) list.
    """
    if root is None:
        root = DATA_DIR
    if scoped is not None:
        if _scan_expired(budget):
            return
        rel, full = rel_from(scoped, root), scoped
        if not glob_pat or (
                fnmatch.fnmatch(rel, glob_pat)
                or fnmatch.fnmatch(os.path.basename(rel), glob_pat)):
            yield rel, full
        return
    for dirpath, dirs, filenames in os.walk(root):
        if _scan_expired(budget):
            return
        # Match the tree: hidden directories are not browsable, so their
        # notes must not appear in search results either.
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in sorted(filenames):
            if _scan_expired(budget):
                return
            if name.startswith(".") or not name.lower().endswith(".md"):
                continue
            full = os.path.join(dirpath, name)
            rel = rel_from(full, root)
            if glob_pat and not (
                    fnmatch.fnmatch(rel, glob_pat)
                    or fnmatch.fnmatch(os.path.basename(rel), glob_pat)):
                continue
            yield rel, full


def _search_match_item(rel, line_no, line, match):
    """Build one {file, line, col, snippet} item; the hit stays <<wrapped>>."""
    start, end = match.start(), match.end()
    lo = max(0, start - SNIPPET_PAD)
    hi = min(len(line), end + SNIPPET_PAD)
    snippet = line[lo:hi]
    # Use offsets within the snippet so we don't corrupt HTML.
    snippet = (
        snippet[: start - lo]
        + "<<"
        + snippet[start - lo : end - lo]
        + ">>"
        + snippet[end - lo :]
    )
    return {"file": rel, "line": line_no, "col": start + 1, "snippet": snippet}


def _search_unique(pattern, scoped, glob_pat, limit, order, desc, root=None,
                   budget=None):
    """One bundle per matching note: first hit, exact count, cap notes.

    Unlike every-match mode the cap is a note cap applied after the whole
    candidate set has been counted and ordered, so ?order=count&desc=1
    ranks by the true per-file count rather than by the first notes seen.

    The deadline is checked between files but not inside one, because a
    bundle's ``count`` must be the whole file's count: a half-counted note
    would report a number that is simply wrong. `budget.tripped` tells the
    caller whether the note set is complete.
    """
    bundles = []
    for rel, full in _iter_search_targets(scoped, glob_pat, root, budget):
        if _scan_expired(budget):
            break
        try:
            with open(full, "r", encoding="utf-8", errors="replace") as f:
                lines = f.read().splitlines()
        except OSError:
            continue
        count = 0
        first = None
        for line_no, line in enumerate(lines, 1):
            for match in pattern.finditer(line):
                if first is None:
                    first = _search_match_item(rel, line_no, line, match)
                count += 1
        if not count:
            continue
        try:
            mtime = os.path.getmtime(full)
        except OSError:
            mtime = 0.0
        first["count"] = count
        bundles.append((rel, mtime, count, first))

    if order == "mtime":
        primary = lambda bundle: bundle[1]
    elif order == "count":
        primary = lambda bundle: bundle[2]
    elif order == "path":
        primary = lambda bundle: bundle[0].lower()
    else:
        primary = None
    if primary is not None:
        # Stable two-pass sort keeps path A-Z as the deterministic tie-break.
        bundles.sort(key=lambda bundle: bundle[0].lower())
        bundles.sort(key=primary, reverse=desc)

    truncated = len(bundles) > limit
    return [bundle[3] for bundle in bundles[:limit]], truncated


def _search_names(pattern, scoped, glob_pat, limit, order, desc, root=None,
                  budget=None):
    """One {file} item per note whose basename matches the pattern.

    Filename mode never opens a note: the candidate set comes from
    ``_iter_search_targets`` and only ``os.path.basename(rel)`` is tested.
    Every note matches at most once, so ``count`` ordering degenerates to
    path ordering and the note cap is applied after ordering. The deadline
    is enforced by the target walk; ``budget.tripped`` reports whether the
    candidate set was cut short.
    """
    bundles = []
    for rel, full in _iter_search_targets(scoped, glob_pat, root, budget):
        if _scan_expired(budget):
            break
        if not pattern.search(os.path.basename(rel)):
            continue
        try:
            mtime = os.path.getmtime(full)
        except OSError:
            mtime = 0.0
        bundles.append((rel, mtime))

    if order == "mtime":
        primary = lambda bundle: bundle[1]
    elif order in ("path", "count"):
        # All notes count once, so count ordering is path ordering.
        primary = lambda bundle: bundle[0].lower()
    else:
        primary = None
    if primary is not None:
        # Stable two-pass sort keeps path A-Z as the deterministic tie-break.
        bundles.sort(key=lambda bundle: bundle[0].lower())
        bundles.sort(key=primary, reverse=desc)

    truncated = len(bundles) > limit
    return [{"file": bundle[0]} for bundle in bundles[:limit]], truncated


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
      limit=N   total match cap (default 200, ceiling 2000); in unique
                mode it caps notes instead
      perFile=N per-file match cap (default 20, ceiling 200); ignored
                in unique mode
      unique=1  one result per note (default off): each item also
                carries count = every occurrence in that file, while
                line/col/snippet describe the first occurrence
      name=1    match q against each note's basename instead of its
                content (default off). Each item is {file} only -- no
                line/col/snippet/count; unique has no effect. limit
                caps notes and perFileTruncated is always false.
      order=... reorder result files by "path" | "mtime" | "count"
                (default keeps root-first walk order); desc=1 reverses.
                Ordering regroups whole files, never splits a file's
                matches; caps still apply during the scan. In unique
                mode ordering runs over the full note set before limit.

    Response shape is unchanged for existing callers:
      {query, matches: [{file, line, col, snippet}], truncated,
       perFileTruncated, timedOut}
    plus "count" on each item in unique mode, and "file" echoed back
    when ?file= scoped. In name mode each item is {file} only and
    perFileTruncated is false. The hit inside each snippet stays wrapped
    in <<...>> so clients can re-highlight safely.

    The scan runs against a wall-clock deadline (SCAN_TIMEOUT_SECONDS) in
    every mode. On expiry the scan stops and the response keeps everything
    found so far with "timedOut": true, because each returned match is
    exact -- partial results plus the flag are more useful than an error.
    "truncated" keeps its own meaning (a match cap was hit), so both flags
    may be true. A single file read cannot be interrupted mid-read; the
    deadline is checked before each file open and between line blocks.
    """
    error = _unknown_workspace_response()
    if error:
        return error
    query = request.args.get("q", "")
    if not query.strip():
        return err("Empty query", 400)
    root = current_root()
    budget = _ScanBudget(SCAN_TIMEOUT_SECONDS)
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
        scoped = safe_path(file_scope, root)
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
    unique = request.args.get("unique", "0") == "1"
    name_mode = request.args.get("name", "0") == "1"

    if name_mode:
        matches_out, truncated = _search_names(
            pattern, scoped, glob_pat, limit, order, desc, root, budget)
        resp = {"query": query, "matches": matches_out,
                "truncated": truncated, "perFileTruncated": False,
                "timedOut": budget.tripped}
        if scoped is not None:
            resp["file"] = rel_from(scoped, root)
        return jsonify(resp)

    if unique:
        matches_out, truncated = _search_unique(
            pattern, scoped, glob_pat, limit, order, desc, root, budget)
        resp = {"query": query, "matches": matches_out,
                "truncated": truncated, "perFileTruncated": False,
                "timedOut": budget.tripped}
        if scoped is not None:
            resp["file"] = rel_from(scoped, root)
        return jsonify(resp)

    # Collect per-file bundles, then order + flatten, so ?order= can
    # regroup files without changing the flat match-item shape.
    bundles = []
    total = 0
    truncated = False
    per_file_truncated = False

    for rel, full in _iter_search_targets(scoped, glob_pat, root, budget):
        if _scan_expired(budget):
            break
        try:
            with open(full, "r", encoding="utf-8", errors="replace") as f:
                lines = f.read().splitlines()
        except OSError:
            continue
        matches_in_file = []
        count_in_file = 0
        file_capped = False
        for i, line in enumerate(lines, 1):
            # Every SCAN_CHECK_LINES lines, and before the first one, ask
            # the budget: a match item is exact on its own, so stopping
            # mid-file only shortens the result, it never corrupts it.
            if i % SCAN_CHECK_LINES == 1 and _scan_expired(budget):
                break
            for m in pattern.finditer(line):
                if total >= limit:
                    truncated = True
                    break
                if count_in_file >= per_file_cap:
                    file_capped = True
                    break
                matches_in_file.append(_search_match_item(rel, i, line, m))
                count_in_file += 1
                total += 1
            if truncated:
                break
        if file_capped:
            per_file_truncated = True
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
    resp = {"query": query, "matches": matches_out, "truncated": truncated,
            "perFileTruncated": per_file_truncated,
            "timedOut": budget.tripped}
    if scoped is not None:
        resp["file"] = rel_from(scoped, root)
    return jsonify(resp)


# --------------------------------------------------------------------------- #
# Routes: graph
# --------------------------------------------------------------------------- #
# Wikilink graph: scans every .md file under the active workspace root and
# extracts the links between notes so the frontend can draw a force-directed
# graph (Obsidian-style "graph view"). Two link syntaxes are recognised:
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


def _normalise_link(raw, src_rel, stem_index, root=None):
    """Resolve a link target against its source file.

    Returns the canonical relative path of the linked .md file, or None
    when the target can't be resolved to a known note. `stem_index` maps
    a file's basename-without-extension to its relative path (built once
    per graph build) so [[wikilinks]] by stem can be looked up cheaply.
    `root` is the active workspace root (default DATA_DIR).
    """
    if root is None:
        root = DATA_DIR
    target = _strip_fragment(raw.strip())
    if not target:
        return None
    # Absolute paths never resolve inside the workspace root (safe_path
    # would block them anyway); drop them.
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
    # folder, normalised so "../sub/x.md" can't escape the root.
    src_dir = os.path.dirname(src_rel)
    candidate = os.path.normpath(os.path.join(src_dir, target))
    norm_root = os.path.normpath(root)
    abs_candidate = os.path.normpath(os.path.join(root, candidate))
    if (abs_candidate == norm_root
            or abs_candidate.startswith(norm_root + os.sep)):
        return candidate.replace(os.sep, "/")
    return None


def build_graph(root=None, budget=None):
    """Walk a workspace root, parse every .md file for links, return the graph.

    `root` defaults to DATA_DIR for direct calls outside a request. Shape:
      { "nodes": [ {"id": "notes/a.md", "name": "a.md", "links": 3}, ... ],
        "edges": [ {"source": "notes/a.md", "target": "notes/b.md"}, ... ] }

    `links` on a node is that node's degree (number of edges touching
    it); the frontend uses it to size nodes. Nodes are every .md file
    found, including orphans (files with no links in or out) so the graph
    matches the file tree the user sees in the Explorer.

    `budget` is the per-request ``_ScanBudget``. The return shape stays a
    plain dict so callers that do not care about the deadline are
    unaffected; when the budget runs out the walk stops and the caller
    reads ``budget.tripped``. The dict is then partial and must not be
    served -- a graph missing half its files is a wrong picture, so the
    route answers 504 instead. Reading one huge file cannot be interrupted
    mid-read: the deadline is checked before each file open and between
    the parse passes over a file's text.
    """
    if root is None:
        root = DATA_DIR
    files = []
    for dirpath, _dirs, filenames in os.walk(root):
        if _scan_expired(budget):
            break
        for name in filenames:
            if name.startswith(".") or not name.lower().endswith(".md"):
                continue
            full = os.path.join(dirpath, name)
            rel = rel_from(full, root)
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
        if _scan_expired(budget):
            break
        abs_path = os.path.join(root, rel)
        try:
            with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
                contents[rel] = f.read()
        except OSError:
            contents[rel] = ""

    edge_set = set()   # frozenset({src, dst}) for undirected dedup
    degree = {rel: 0 for rel in files}
    for src_rel in files:
        if _scan_expired(budget):
            break
        text = contents.get(src_rel, "")
        targets = set()
        for m in _WIKILINK_RE.finditer(text):
            resolved = _normalise_link(m.group(1), src_rel, stem_index, root)
            if resolved and resolved in degree:
                targets.add(resolved)
        for m in _MD_LINK_RE.finditer(text):
            resolved = _normalise_link(m.group(2), src_rel, stem_index, root)
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
    """Wikilink/markdown-link graph for the active workspace.

    Walks and parses every note under the workspace root, so the scan runs
    against the wall-clock deadline SCAN_TIMEOUT_SECONDS. When it expires
    the response is 504 {"error": "The notebook took too long to scan",
    "code": "timeout"} with no partial graph: half a graph is a wrong
    picture of the notebook. A single file read cannot be interrupted
    mid-read; the deadline is checked before each file open, so one
    enormous note can overrun it by at most its own read time.
    """
    error = _unknown_workspace_response()
    if error:
        return error
    budget = _ScanBudget(SCAN_TIMEOUT_SECONDS)
    result = build_graph(current_root(), budget)
    if budget.tripped:
        return err("The notebook took too long to scan", 504, code="timeout")
    return jsonify(result)


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
    # An unknown API path must not fall through to the shell: a client that
    # typos an endpoint would get HTML with 200 instead of a JSON 404.
    if p == "api" or p.startswith("api/"):
        return err("Not found", 404)
    return _render_index()


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

# One-shot, best-effort startup maintenance, now that the folders exist:
# fold legacy top-level config keys under workspaceState["default"], then
# rebuild the registry when the carried file is stale (an old DATA_DIR path,
# a corrupt item list, or more entries than the cap). Reads stay pure -- only
# startup and the mutating routes ever write these files.
_migrate_config_at_startup()
if _persist_workspaces_if_changed():
    seed_notes.append("Rebuilt config/workspaces.json")

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