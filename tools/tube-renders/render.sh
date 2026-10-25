#!/usr/bin/env bash
# Re-renders every Tubes part and panel, then packs them for chiketi.
#   TUBE_RENDER_HOST=user@gpu-host TUBE_BLENDER=/path/to/blender tools/tube-renders/render.sh
# The host needs Blender 4.5 LTS with Cycles (OptiX on an NVIDIA GPU makes it quick:
# about ten seconds a panel). This machine needs Python 3 with Pillow and fontTools.
# Scripts and fonts go to a temporary folder on the host; the PNGs come back into
# build/tube-renders/; pack.py writes chiketi/assets/tubes/ and assets/ui/tubes_layout.js.
set -euo pipefail
HOST=${TUBE_RENDER_HOST:?set TUBE_RENDER_HOST=user@host}
BLENDER=${TUBE_BLENDER:?set TUBE_BLENDER to the Blender binary on that host}
PY=${TUBE_PYTHON:-python3}   # a Python with Pillow and fontTools
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
FONTS=$REPO/chiketi/assets/fonts
OUT=$REPO/build/tube-renders
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cp "$HERE"/{layout,panel,parts,tubes,in12}.py "$FONTS/IBMPlexMono-Regular.ttf" "$STAGE/"
# The IN-12 cathodes are cut from Antonio at weight 100: an instance of the bundled variable
# font, made here for the render only (never shipped).
"$PY" - "$FONTS/Antonio-VariableFont.ttf" "$STAGE/Antonio-Thin.ttf" <<'PY'
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
instancer.instantiateVariableFont(TTFont(sys.argv[1]), {'wght': 100}).save(sys.argv[2])
PY

REMOTE=$(ssh "$HOST" 'mktemp -d')
scp -q "$STAGE"/* "$HOST:$REMOTE/"
ssh "$HOST" "cd '$REMOTE' && mkdir out &&
  '$BLENDER' -b -P parts.py -- out 256 >log-parts.txt 2>&1 &&
  '$BLENDER' -b -P tubes.py -- out 384 >log-tubes.txt 2>&1 &&
  '$BLENDER' -b -P in12.py -- out 384 >log-in12.txt 2>&1 &&
  '$BLENDER' -b -P panel.py -- out 256 >log-panel.txt 2>&1" ||
  { echo "render failed; logs in $HOST:$REMOTE/log-*.txt" >&2; exit 1; }
rm -rf "$OUT" && mkdir -p "$OUT"
scp -q "$HOST:$REMOTE/out/*" "$OUT/"
# What made these files (GPU renders are not bit-reproducible, so the manifest says how).
ssh "$HOST" "'$BLENDER' --version | head -1" | "$PY" -c 'import json, sys; json.dump({"blender": sys.stdin.read().strip(), "samples": {"panel": 256, "parts": 256, "tubes": 384, "in12": 384}}, open(sys.argv[1], "w"))' "$OUT/render-info.json"
ssh "$HOST" "rm -rf '$REMOTE'"
"$PY" "$HERE/pack.py" "$OUT"
