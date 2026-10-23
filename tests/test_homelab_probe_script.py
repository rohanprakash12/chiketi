# tests/test_homelab_probe_script.py
"""The real probe script, run on this machine. Linux only."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys

import pytest

PROBE = os.path.join(os.path.dirname(__file__), "..", "chiketi", "assets", "probe", "chiketi-probe")
SMART = os.path.join(os.path.dirname(__file__), "..", "chiketi", "assets", "probe", "smart-read")

pytestmark = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="probe is Linux-only")


def run_probe() -> dict[str, list[str]]:
    out = subprocess.run(["sh", PROBE], capture_output=True, text=True, timeout=60, check=True).stdout
    keys: dict[str, list[str]] = {}
    for line in out.splitlines():
        k, _, v = line.partition("=")
        keys.setdefault(k, []).append(v)
    return keys


def test_probe_prints_required_keys():
    keys = run_probe()
    assert keys["probe_version"] == ["1"]
    assert keys["kind"][0] in ("linux", "unraid")
    assert int(keys["mem_total_kb"][0]) > 0
    assert int(keys["mem_avail_kb"][0]) >= 0
    assert any(v.startswith("/|") for v in keys.get("fs", [])), keys.get("fs")


def test_probe_never_wakes_disks():
    with open(SMART) as f:
        src = f.read()
    assert "-n standby" in src
    assert "exec smartctl" in src


def test_smart_read_rejects_bad_device_names():
    for bad in ["", "../sda", "sda;id", "sda b", "/dev/sda"]:
        r = subprocess.run(["sh", SMART, bad], capture_output=True, text=True, check=False)
        assert r.returncode == 2, bad


@pytest.mark.skipif(shutil.which("shellcheck") is None, reason="shellcheck not installed")
def test_shellcheck_clean():
    subprocess.run(["shellcheck", "-s", "sh", PROBE, SMART], check=True)
