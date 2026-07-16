"""Markdown notebook server.

A small, single-user Flask app that serves a Markdown notebook over the web.
Backend (this file) is JSON-only; the frontend lives under templates/ + static/
and renders Markdown client-side. Notebook data lives in data/, user config in
config/ -- two separate folders by design.
"""

import argparse
import json
import os
import re
import secrets
import shutil
import socket
import time

import bcrypt
from flask import Flask, jsonify, render_template, request, session

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# NOTEBOOK_DATA_DIR / NOTEBOOK_CONFIG_DIR let tests (and alternate installs)
# point the data and config folders elsewhere. Default to the project folders.
DATA_DIR = os.environ.get("NOTEBOOK_DATA_DIR") or os.path.join(BASE_DIR, "notebook")
# Resolve symlinks once at import time so safe_path() can compare against
# the real boundary. This lets the user symlink DATA_DIR itself (e.g. as a
# shortcut to a different folder) without every file read failing; only
# *interior* symlinks that escape DATA_DIR are still blocked.
DATA_DIR_REAL = os.path.realpath(DATA_DIR)
CONFIG_DIR = os.environ.get("NOTEBOOK_CONFIG_DIR") or os.path.join(BASE_DIR, "config")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
# Auth lives in its own file so the UI-prefs blob (POSTed by any client) can
# never accidentally include hashed credentials. Schema:
#   {"secret": "<hex>", "admin_password_hash": "<bcrypt>", "viewer_password_hash": "<bcrypt>"}
# Either password hash may be empty/missing to leave that role disabled. If
# both are unset the whole auth layer is bypassed.
AUTH_FILE = os.path.join(CONFIG_DIR, "auth.json")
# On first run, if DATA_DIR doesn't exist, the contents of this folder are
# copied into it. Ship a tiny starter notebook under notebook.template/ so
# new users see something useful on first launch.
TEMPLATE_DIR = os.path.join(BASE_DIR, "notebook.template")

# Search caps so payloads stay sane.
MAX_TOTAL_MATCHES = 200
MAX_MATCHES_PER_FILE = 20
SNIPPET_PAD = 60  # chars of context each side of a match

app = Flask(__name__)


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
    Blocks `..` traversal, absolute input, and symlink escapes.

    The boundary is DATA_DIR itself: the user can pass any relative path
    that resolves to a file under DATA_DIR (after following symlinks).
    If DATA_DIR itself is a symlink (e.g. ``notebook -> notebook.template``),
    the comparison is done against the resolved path so that legitimate
    uses of a top-level symlink still work; only *interior* symlinks that
    would escape the data dir are blocked.
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
    real = os.path.realpath(candidate)
    # DATA_DIR_REAL is the realpath-resolved boundary, computed once at
    # import time. See the assignment below the search constants.
    if real == DATA_DIR_REAL or real.startswith(DATA_DIR_REAL + os.sep):
        return real
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
    """True if the admin password hash is set. The auth layer is "on" iff
    the admin password exists; the viewer password is optional and only
    affects whether reads also need a session."""
    data = load_auth()
    return bool(data.get("admin_password_hash"))


def viewer_required():
    """True if reads need a session: both the admin and the viewer
    password are set. With only the admin password configured, reads
    are open (only writes are gated)."""
    data = load_auth()
    return bool(data.get("admin_password_hash") and data.get("viewer_password_hash"))


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
    """Require either no auth configured, or a session with a role."""
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not auth_enabled():
            return view(*args, **kwargs)
        if not session.get("role"):
            return err("Unauthorized", 401)
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    """Require the session role to be 'admin'. Always require login too."""
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not auth_enabled():
            return view(*args, **kwargs)
        role = session.get("role")
        if not role:
            return err("Unauthorized", 401)
        if role != "admin":
            return err("Forbidden", 403)
        return view(*args, **kwargs)

    return wrapped


def read_login_required(view):
    """Like @login_required, but only fires when reads are actually gated
    (admin pw set AND viewer pw set). Without a viewer password, reads
    are open even with the auth layer on. Used for the read-only routes
    (tree, file GET, config GET, info, search)."""
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not viewer_required():
            return view(*args, **kwargs)
        if not session.get("role"):
            return err("Unauthorized", 401)
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------- #
# Routes: page + config
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return render_template("index.html")


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
      enabled   -- True if the admin password is set (auth layer is on)
      hasAdmin  -- True if the admin password hash is non-empty
      hasViewer -- True if the viewer password hash is non-empty
                   (independent of admin; the UI shows this as the
                   "require a password to read" toggle state)
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
    """Set or change the admin and/or viewer password.

    Body: {"admin_password": "...", "viewer_password": "..."}. Either
    field may be omitted. Empty `admin_password` is rejected (the admin
    password cannot be cleared via this route -- once enabled, the auth
    layer stays on; clearing requires hand-editing the file). Empty
    `viewer_password` clears the viewer hash. Both fields are bcrypt-
    hashed server-side before persisting.

    Returns the new state ({hasAdmin, hasViewer}) so the client can
    update its UI without a follow-up /api/auth call.
    """
    data, error = expect_json("admin_password", "viewer_password")
    if error:
        return error
    admin_pw = data["admin_password"]
    viewer_pw = data["viewer_password"]
    # None means "don't touch this field"; string means "set/change";
    # anything else is a type error.
    if not (admin_pw is None or isinstance(admin_pw, str)):
        return err("admin_password must be a string or null", 400)
    if not (viewer_pw is None or isinstance(viewer_pw, str)):
        return err("viewer_password must be a string or null", 400)

    auth = load_auth()
    # Admin password is permanent once set; you can change it (provide
    # a new value) but not clear it. Semantics of each field:
    #   null  -> don't touch this field
    #   ""    -> clear this field (only meaningful for viewer; admin
    #            cannot be cleared once set)
    #   str   -> bcrypt-hash and set
    # Length checks only apply to non-empty values; empty is the
    # "clear" signal for viewer and a guarded "refuse" for admin.
    if admin_pw not in (None, "") and len(admin_pw) < _MIN_PASSWORD_LEN:
        return err("Admin password must be at least %d characters"
                   % _MIN_PASSWORD_LEN, 400)
    if viewer_pw not in (None, "") and len(viewer_pw) < _MIN_PASSWORD_LEN:
        return err("Viewer password must be at least %d characters"
                   % _MIN_PASSWORD_LEN, 400)

    if admin_pw is None:
        # leave as-is
        pass
    elif admin_pw == "":
        if not auth.get("admin_password_hash"):
            return err("Admin password is required to enable auth", 400)
        return err("Admin password cannot be cleared via this route", 400)
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
# Routes: file tree + read/write
# --------------------------------------------------------------------------- #
@app.route("/api/tree", methods=["GET"])
@read_login_required
def tree():
    return jsonify({"tree": build_tree(DATA_DIR)})


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


# --------------------------------------------------------------------------- #
# Routes: create / move / copy / delete
# --------------------------------------------------------------------------- #
@app.route("/api/create", methods=["POST"])
@admin_required
def create():
    data, error = expect_json("path", "type")
    if error:
        return error
    rel = data["path"]
    item_type = data["type"]
    if item_type not in ("file", "dir"):
        return err("type must be 'file' or 'dir'", 400)
    abs_path = safe_path(rel)
    if abs_path is None:
        return err("Invalid path", 400)
    if os.path.exists(abs_path):
        return err("Already exists", 409)
    try:
        if item_type == "file":
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            atomic_write(abs_path, "")
        else:
            os.makedirs(abs_path, exist_ok=False)
    except OSError as exc:
        return err("Could not create: %s" % exc, 500)
    return jsonify({"path": rel})


@app.route("/api/move", methods=["POST"])
@admin_required
def move():
    data, error = expect_json("from", "to")
    if error:
        return error
    src = safe_path(data["from"])
    dst = safe_path(data["to"])
    if src is None or dst is None:
        return err("Invalid path", 400)
    if not os.path.exists(src):
        return err("Source not found", 404)
    if os.path.exists(dst):
        return err("Destination already exists", 409)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.rename(src, dst)
    except OSError as exc:
        return err("Could not move: %s" % exc, 500)
    return jsonify({"from": data["from"], "to": data["to"]})


@app.route("/api/copy", methods=["POST"])
@admin_required
def copy():
    data, error = expect_json("from", "to")
    if error:
        return error
    src = safe_path(data["from"])
    dst = safe_path(data["to"])
    if src is None or dst is None:
        return err("Invalid path", 400)
    if not os.path.exists(src):
        return err("Source not found", 404)
    if os.path.exists(dst):
        return err("Destination already exists", 409)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
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
@app.route("/api/search", methods=["GET"])
@read_login_required
def search():
    query = request.args.get("q", "")
    case_sensitive = request.args.get("case", "0") == "1"
    if not query.strip():
        return err("Empty query", 400)

    flags = 0 if case_sensitive else re.IGNORECASE
    pattern = re.compile(re.escape(query), flags)

    matches = []
    total = 0
    truncated = False

    for dirpath, _dirs, filenames in os.walk(DATA_DIR):
        # Skip dotfiles dirs in-place so os.walk prunes them.
        for name in sorted(filenames):
            if name.startswith(".") or not name.lower().endswith(".md"):
                continue
            full = os.path.join(dirpath, name)
            rel = rel_from(full)
            try:
                with open(full, "r", encoding="utf-8", errors="replace") as f:
                    lines = f.read().splitlines()
            except OSError:
                continue
            count_in_file = 0
            for i, line in enumerate(lines, 1):
                for m in pattern.finditer(line):
                    if total >= MAX_TOTAL_MATCHES:
                        truncated = True
                        return jsonify({
                            "query": query,
                            "matches": matches,
                            "truncated": truncated,
                        })
                    if count_in_file >= MAX_MATCHES_PER_FILE:
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
                    matches.append({
                        "file": rel,
                        "line": i,
                        "col": start + 1,
                        "snippet": snippet,
                    })
                    count_in_file += 1
                    total += 1
            if truncated:
                break
        if truncated:
            break

    return jsonify({"query": query, "matches": matches, "truncated": truncated})


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
    return render_template("index.html")


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