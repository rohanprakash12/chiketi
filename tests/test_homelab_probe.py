# tests/test_homelab_probe.py
from __future__ import annotations

import os

import pytest

from chiketi.collectors.homelab.probe import ProbeError, parse_probe

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "homelab")


def read(name: str) -> str:
    with open(os.path.join(FIX, name)) as f:
        return f.read()


def test_linux_healthy():
    r = parse_probe(read("linux_healthy.txt"))
    assert r.version == 1 and r.kind == "linux"
    assert r.mem_total_kb == 8000000 and r.mem_avail_kb == 6000000
    assert r.filesystems == {"/": 14.0, "/boot/efi": 1.0}
    assert r.cpu_temp_c == 41.0
    (d,) = r.disks
    assert (d.dev, d.model, d.temp_c, d.realloc, d.pending, d.offline_unc, d.health) == \
        ("sda", "Samsung SSD 840 EVO 120GB", 31.0, 0, 0, 0, "PASSED")
    assert r.failed_count == 0 and r.failed_units == []
    assert r.sec_updates == 0


def test_unraid_degraded():
    r = parse_probe(read("unraid_degraded.txt"))
    assert r.kind == "unraid"
    assert r.unraid_array == "STARTED"
    assert r.unraid_disks["disk2"] == "DISK_DSBL"
    assert r.unraid_parity_errors == 3
    blank = next(d for d in r.disks if d.dev == "sdc")
    assert blank.temp_c is None and blank.realloc is None and blank.health == ""


def test_failed_units_list():
    r = parse_probe("probe_version=1\nfailed_units=2|a.service,b.service,\n")
    assert r.failed_count == 2 and r.failed_units == ["a.service", "b.service"]


def test_gpu_temps_repeat():
    r = parse_probe("probe_version=1\ngpu_temp_c=60\ngpu_temp_c=71\n")
    assert r.gpu_temps == [60.0, 71.0]


@pytest.mark.parametrize("text", ["", "hello", "kind=linux\n", "probe_version=abc\n", "probe_version=0\n"])
def test_rejects_non_probe_output(text):
    with pytest.raises(ProbeError):
        parse_probe(text)


def test_bad_numbers_become_none():
    r = parse_probe("probe_version=1\nmem_total_kb=lots\nfs=/|n/a\n")
    assert r.mem_total_kb is None
    assert r.filesystems == {}


def test_line_cap():
    text = "probe_version=1\n" + "fs=/x|1\n" * 10000
    assert parse_probe(text).version == 1


def test_unraid_array_pct():
    r = parse_probe("probe_version=1\nkind=unraid\nunraid_array_pct=87\n")
    assert r.unraid_array_pct == 87.0
