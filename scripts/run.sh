#!/usr/bin/env bash
# Launch chiketi dashboard
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Activate venv if it exists
if [ -f ".venv/bin/activate" ]; then
    # shellcheck disable=SC1091  # created by `python -m venv`; not in the repo
    source .venv/bin/activate
fi

# Leave DISPLAY unset when the caller did not set it. `${DISPLAY:-:1}` always
# produced a value, which short-circuits chiketi's own _detect_display() --
# it returns $DISPLAY first, so the loginctl / /proc / X-lock-file scan never
# ran and a kiosk on any display other than :1 was never found. Force a
# specific display with CHIKETI_DISPLAY.
if [ -n "${CHIKETI_DISPLAY:-}" ]; then
    export DISPLAY="$CHIKETI_DISPLAY"
fi

# Disable screen blanking / sleep if running under X
if [ -n "${DISPLAY:-}" ]; then
    xset -dpms 2>/dev/null || true
    xset s off 2>/dev/null || true
    xset s noblank 2>/dev/null || true
fi

exec python -m chiketi "$@"
