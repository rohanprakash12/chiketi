"""This repository is public: no real network details may be committed.

Addresses, host names and paths of a real deployment belong in that
deployment's config files (~/.config/chiketi/*.toml, the kiosk's own URL) or in
a private companion repository, never in code, docs, specs, plans or tests.
Use the documentation ranges instead: 192.0.2.0/24, 198.51.100.0/24,
203.0.113.0/24 (RFC 5737), and placeholder MACs such as 02:00:00:00:00:01 or
AA:BB:CC:DD:EE:FF.

A line that genuinely needs a private address (e.g. to test private-range
handling) can carry the marker `private-ip-ok`.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

PRIVATE_V4 = re.compile(
    r"(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r"|192\.168\.\d{1,3}\.\d{1,3})(?![\d.])"
)
MAC = re.compile(r"(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:])")
PLACEHOLDER_MACS = {"00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "aa:bb:cc:dd:ee:ff"}
# Locally administered (x2:...) MACs are made up by definition.
LOCAL_MAC = re.compile(r"^[0-9a-f][26ae]:", re.IGNORECASE)
SKIP = ("ui_ideas/", "chiketi/assets/fonts/", "docs/assets/")


def tracked_text_files():
    try:
        out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True,
                             text=True, check=True).stdout.split("\n")
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("not a git checkout")
    for rel in out:
        if not rel or rel.startswith(SKIP):
            continue
        try:
            text = (ROOT / rel).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        yield rel, text


def findings():
    found = []
    for rel, text in tracked_text_files():
        for n, line in enumerate(text.splitlines(), 1):
            if "private-ip-ok" in line:
                continue
            for m in PRIVATE_V4.finditer(line):
                found.append(f"{rel}:{n}: private address {m.group(0)}")
            for m in MAC.finditer(line):
                mac = m.group(0).lower()
                if mac not in PLACEHOLDER_MACS and not LOCAL_MAC.match(mac):
                    found.append(f"{rel}:{n}: MAC address {m.group(0)}")
    return found


def test_no_private_addresses_or_real_macs():
    bad = findings()
    assert not bad, "real network details in a public repo:\n" + "\n".join(bad[:40])


def test_patterns_catch_what_they_should():
    assert PRIVATE_V4.search("ssh user@192.168.200.1")  # private-ip-ok
    assert PRIVATE_V4.search("url = http://10.1.2.3:8766/")  # private-ip-ok
    assert PRIVATE_V4.search("172.20.0.5")  # private-ip-ok
    assert not PRIVATE_V4.search("192.0.2.10 198.51.100.9 203.0.113.7 127.0.0.1 1.10.0.0.5")
    assert MAC.search("00:1b:44:11:3a:b7")  # private-ip-ok
    assert LOCAL_MAC.match("02:00:00:00:00:01")
