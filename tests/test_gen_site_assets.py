"""The website generator is reproducible: CI regenerates docs/site/ and fails on any diff."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "site" / "data.js"


def _generate() -> str:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "gen_site_assets.py")], check=True,
                   capture_output=True, cwd=str(ROOT))
    return DATA.read_text(encoding="utf-8")


def test_data_js_does_not_depend_on_the_clock():
    first = _generate()
    time.sleep(1.1)        # fixture timestamps are whole seconds
    assert _generate() == first


def test_data_js_rebases_demo_times_to_the_viewer_clock():
    data = _generate()
    assert "window.SITE_EPOCH = " in data and "rebase" in data
