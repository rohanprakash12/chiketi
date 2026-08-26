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
    result = subprocess.run(
        ["node", str(HARNESS)],
        capture_output=True,
        text=True,
        timeout=120,
        env={**os.environ, "CHIKETI_PYTHON": sys.executable},
    )
    assert result.returncode == 0, (
        "renderer harness failed:\n" + result.stdout + result.stderr
    )
