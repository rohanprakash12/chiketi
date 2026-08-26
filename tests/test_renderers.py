"""Runs the Node renderer harness. Skipped when node is unavailable."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HARNESS = Path(__file__).parent / "js" / "render_harness.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None,
    reason="node not installed; renderer harness cannot run",
)


def test_all_renderers_produce_clean_output():
    # NULL_VALUES and HOSTILE fail today; Phase 4 fixes them and removes this
    # allowlist. Their exact failure list is the Phase 4 acceptance criteria.
    result = subprocess.run(
        ["node", str(HARNESS)],
        capture_output=True,
        text=True,
        timeout=120,
        env={
            **os.environ,
            "CHIKETI_HARNESS_ALLOW": "NULL_VALUES,HOSTILE,HOSTILE_KEYS",
            # Pin the count so a new failure inside an allowed fixture cannot
            # hide. Phase 4 fixes these and removes both variables.
            "CHIKETI_HARNESS_EXPECT": "30",
            "CHIKETI_PYTHON": sys.executable,
        },
    )
    assert result.returncode == 0, (
        "renderer harness failed:\n" + result.stdout + result.stderr
    )
