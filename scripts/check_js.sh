#!/usr/bin/env bash
# Syntax-check the UI JavaScript.
#
# display_app.js and control_app.js are not standalone .js files: server.py
# inlines them into HTML, so they are wrapped in <script> tags (display_app.js
# has two blocks). `node --check` chokes on those tags, so strip them first.
# They also contain __SHARED_HELPERS__ / __SCREEN_FUNCTIONS__ placeholders,
# which parse fine as bare identifier expressions.
set -euo pipefail
cd "$(dirname "$0")/.."
status=0
for f in chiketi/assets/ui/*.js; do
    if grep -q '<script>' "$f"; then
        body=$(sed -e 's|</\?script>||g' "$f")
    else
        body=$(cat "$f")
    fi
    if printf '%s' "$body" | node --check - 2>/dev/null; then
        echo "ok   $f"
    else
        echo "FAIL $f"
        printf '%s' "$body" | node --check - || true
        status=1
    fi
done
exit $status
