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


def test_dashboard_bundle_initialises():
    """The site bundle must carry everything screen_functions.js refers to: it once
    lacked the Kiosk look files, and the first reference (tngHomelab) threw at load."""
    _generate()
    site = ROOT / "docs" / "site"
    js = ("var window = globalThis; window.document = undefined;\n"
          + (site / "data.js").read_text(encoding="utf-8") + "\n"
          + "var PANEL_SPEC = window.PANEL_SPEC, SCREEN_SPEC = window.SCREEN_SPEC;\n"
          + (site / "dashboard.js").read_text(encoding="utf-8") + "\n"
          + "if (typeof window.SITE_SCREENS !== 'function') throw new Error('no SITE_SCREENS');\n"
          + "for (const k of ['Sci-Fi/TNG', 'Terminal/Arch']) {\n"
          + "  const f = k.split('/'); if (!window.SITE_SCREENS(f[0], f[1]).length) throw new Error(k);\n"
          + "}\nconsole.log('ok');\n")
    out = subprocess.run(["node", "-"], input=js, capture_output=True, text=True, cwd=str(ROOT))
    assert out.returncode == 0 and out.stdout.strip().endswith("ok"), out.stderr[-800:]
