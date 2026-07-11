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
import shutil

from flask import Flask, jsonify, render_template, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CONFIG_DIR = os.path.join(BASE_DIR, "config")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")

WELCOME_MD = """# Welcome to your notebook

This is a local Markdown notebook. Notes live as `.md` files in `data/`.

## Getting around

- **Left sidebar**: browse, open, rename, copy, and delete files. Right-click a
  file or folder for actions.
- **Search**: type in the top bar to search inside all notebooks.
- **Right outline**: a table of contents of headings -- click to jump, and the
  current section is highlighted as you scroll.

## A code block

```python
def greet(name):
    return f"Hello, {name}!"
```

## Nested headings

### Third level

Some text under a third-level heading.

### Another third level

More text here so the section is long enough to scroll past.

## Final section

That's it. Create a new file from the top bar or the sidebar context menu.
"""

# Search caps so payloads stay sane.
MAX_TOTAL_MATCHES = 200
MAX_MATCHES_PER_FILE = 20
SNIPPET_PAD = 60  # chars of context each side of a match

app = Flask(__name__)


# --------------------------------------------------------------------------- #
# Startup seeding
# --------------------------------------------------------------------------- #
def seed():
    """Ensure data/ and config/ exist with minimal defaults on first run."""
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(CONFIG_DIR, exist_ok=True)
    if not os.listdir(DATA_DIR):
        with open(os.path.join(DATA_DIR, "Welcome.md"), "w", encoding="utf-8") as f:
            f.write(WELCOME_MD)
    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump({}, f)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def safe_path(rel_path):
    """Resolve a user-supplied relative path against DATA_DIR safely.

    Returns the real absolute path if it stays within DATA_DIR, else None.
    Blocks `..` traversal, absolute input, and symlink escapes.
    """
    if not rel_path or not isinstance(rel_path, str):
        return None
    rel = rel_path.strip().lstrip("/")
    if not rel:
        return None
    candidate = os.path.normpath(os.path.join(DATA_DIR, rel))
    real = os.path.realpath(candidate)
    if real == DATA_DIR or real.startswith(DATA_DIR + os.sep):
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
# Routes: page + config
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config", methods=["GET"])
def get_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        cfg = {}
    return jsonify(cfg)


@app.route("/api/config", methods=["POST"])
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
# Routes: file tree + read/write
# --------------------------------------------------------------------------- #
@app.route("/api/tree", methods=["GET"])
def tree():
    return jsonify({"tree": build_tree(DATA_DIR)})


@app.route("/api/file", methods=["GET"])
def file_get():
    rel = request.args.get("path", "").strip()
    abs_path = safe_path(rel)
    if abs_path is None:
        return err("Invalid path", 400)
    if not os.path.isfile(abs_path):
        return err("File not found", 404)
    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError as exc:
        return err("Could not read file: %s" % exc, 500)
    return jsonify({"path": rel, "content": content, "size": len(content)})


@app.route("/api/file", methods=["POST"])
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
        default="127.0.0.1",
        help="Bind address. Use 0.0.0.0 to expose on the LAN (mind the "
             "debug-mode warning if you do).",
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
        default=True,
        help="Flask debug + auto-reload. Use --no-debug for a quieter server.",
    )
    return parser.parse_args(argv)


seed()

if __name__ == "__main__":
    args = parse_args()
    print("Markdown notebook server")
    print("  data  : %s" % DATA_DIR)
    print("  config: %s" % CONFIG_DIR)
    print("  -> http://%s:%d  (Ctrl+C to quit)" % (args.host, args.port))
    if args.debug and args.host not in ("127.0.0.1", "localhost"):
        print("  WARNING: debug=True with a non-loopback host enables the "
              "interactive debugger -- anyone reachable can run code. Pass "
              "--no-debug if exposed.")
    app.run(host=args.host, port=args.port, debug=args.debug)