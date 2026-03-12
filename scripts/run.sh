#!/usr/bin/env bash
# Launch chiketi dashboard
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Activate venv if it exists
if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
fi

# Default to DISPLAY=:1 for GeeekPi kiosk if not set
export DISPLAY="${DISPLAY:-:1}"

# Disable screen blanking / sleep if running under X
if [ -n "${DISPLAY:-}" ]; then
    xset -dpms 2>/dev/null || true
    xset s off 2>/dev/null || true
    xset s noblank 2>/dev/null || true
fi

exec python -m chiketi "$@"
