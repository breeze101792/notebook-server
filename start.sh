#!/usr/bin/env bash
#
# start.sh -- set up the Python venv (if missing) and run the notebook server.
#
# Usage:
#   ./start.sh                 # run with defaults (127.0.0.1:5000, debug on)
#   ./start.sh --port 8080     # change the port
#   ./start.sh --host 0.0.0.0 --port 8000 --no-debug
#   ./start.sh --help          # see all app.py options
#
# Any arguments after the flags above are forwarded straight to app.py.

set -euo pipefail

# Resolve the project dir from the script's own location, so this works
# no matter where it's invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR=".venv_$(hostname)"
REQ_FILE="requirements.txt"

# --- 1. Create the venv if it doesn't exist -----------------------------
if [ ! -d "$VENV_DIR" ]; then
  echo ">> creating python virtualenv at $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi

# venv's python + pip
PY="$VENV_DIR/bin/python"
PIP="$VENV_DIR/bin/pip"

# --- 2. Ensure dependencies are installed -------------------------------
# Re-run if requirements.txt changed since last install (tracked via a stamp).
STAMP="$VENV_DIR/.installed"
NEED_INSTALL=0
if [ ! -f "$STAMP" ]; then
  NEED_INSTALL=1
elif [ -f "$REQ_FILE" ] && ! cmp -s "$REQ_FILE" "$STAMP"; then
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  echo ">> installing dependencies from $REQ_FILE"
  "$PIP" install -r "$REQ_FILE"
  cp "$REQ_FILE" "$STAMP"   # record what we installed
fi

# --- 3. Launch the app, forwarding all CLI args -------------------------
echo ">> starting notebook server"
exec "$PY" app.py "$@"