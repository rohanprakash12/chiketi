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

# Second pass: the pages as the server builds them. The raw files above still
# hold placeholders (__SCREEN_SPEC_JSON__ and friends), which parse as bare
# identifiers, so a missed replacement would pass there. Here every placeholder
# must be gone and every inlined <script> block must parse.
PY=${CHIKETI_PYTHON:-}
if [ -z "$PY" ]; then
    if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python3; fi
fi
tmp=$(mktemp -d)
"$PY" - "$tmp" <<'PYEOF' || status=1
import re
import sys

from chiketi import server

out = sys.argv[1]
bad = 0
for name, html in (("display", server._build_display_html()), ("control", server._build_html())):
    left = sorted(set(re.findall(r"__[A-Z][A-Z_]+__", html)))
    if left:
        print(f"FAIL {name}: placeholders left: {left}")
        bad = 1
    for i, block in enumerate(re.findall(r"<script>(.*?)</script>", html, re.S)):
        with open(f"{out}/{name}-{i}.js", "w") as fh:
            fh.write(block)
sys.exit(bad)
PYEOF
for f in "$tmp"/*.js; do
    if node --check "$f" 2>/dev/null; then
        echo "ok   built $(basename "$f")"
    else
        echo "FAIL built $(basename "$f")"
        node --check "$f" || true
        status=1
    fi
done
rm -rf "$tmp"
exit $status
