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


V2 = """probe_version=2
kind=linux
gpu_query=ok|2
gpu=0|Tesla V100|35|1200|32768|61|120.5|250||0x0000000000000004|00000000:01:00.0
gpu=1|Tesla V100|0|0|32768||25.1|250||0x0|00000000:02:00.0
gpu_temp_c=61
gpu_procs_query=ok
gpu_procs=00000000:01:00.0|2
"""


def test_v2_gpus():
    r = parse_probe(V2)
    assert r.gpu_query == "ok" and r.gpu_rows == 2 and len(r.gpus) == 2
    g0, g1 = r.gpus
    assert (g0.index, g0.name, g0.util, g0.vram_used, g0.vram_total, g0.temp, g0.power, g0.power_limit) == \
        (0, "Tesla V100", 35.0, 1200.0, 32768.0, 61.0, 120.5, 250.0)
    assert g0.fan is None and g0.throttle == 4 and g0.procs == 2 and g0.detail is True
    assert g1.temp is None and g1.procs == 0                       # query ok, no line -> 0


def test_v2_failed_procs_query_is_unknown():
    r = parse_probe(V2.replace("gpu_procs_query=ok", "gpu_procs_query=fail|4"))
    assert [g.procs for g in r.gpus] == [None, None]


def test_v1_gpus_are_legacy_temperature_rows():
    r = parse_probe("probe_version=1\ngpu_temp_c=70\ngpu_temp_c=40\n")
    assert r.gpu_query == "legacy"
    assert [(g.index, g.temp, g.detail) for g in r.gpus] == [(0, 70.0, False), (1, 40.0, False)]


@pytest.mark.parametrize("line", [
    "gpu=x|n|1|2|3|4|5|6|7|0x0|b",           # bad index
    "gpu=0|n|1|2|3|4|5|6|7|0x0",             # 10 fields
    "gpu=-1|n|1|2|3|4|5|6|7|0x0|b",          # negative
])
def test_bad_gpu_lines_dropped(line):
    r = parse_probe(f"probe_version=2\ngpu_query=ok|1\n{line}\n")
    assert r.gpus == [] and r.gpu_rows == 1


def test_duplicate_index_dropped():
    r = parse_probe("probe_version=2\ngpu_query=ok|2\ngpu=0|a|1|2|3|4|5|6|7|0x0|b\ngpu=0|b|1|2|3|4|5|6|7|0x0|c\n")
    assert len(r.gpus) == 1 and r.gpu_rows == 2


def test_nan_inf_and_hex():
    r = parse_probe("probe_version=2\ngpu_query=ok|1\ngpu=0|n|nan|inf|-inf|1e400|NaN|5|6|zz|b\n")
    g = r.gpus[0]
    assert (g.util, g.vram_used, g.vram_total, g.temp, g.power, g.throttle) == (None, None, None, None, None, None)


def test_gpu_cap_and_tool_absent():
    lines = "".join(f"gpu={i}|n|1|2|3|4|5|6|7|0x0|b{i}\n" for i in range(20))
    assert len(parse_probe(f"probe_version=2\ngpu_query=ok|20\n{lines}").gpus) == 16
    assert parse_probe("probe_version=2\ngpu_tool=absent\n").gpu_tool == "absent"
    assert parse_probe("probe_version=2\ngpu_query=fail|9\n").gpu_query == "fail"


# --- UUID and memory temperature (spec §6.4) ---

def test_twelve_fields_carry_uuid_and_eleven_still_parse():
    r = parse_probe("probe_version=2\ngpu_query=ok|2\n"
                    "gpu=0|a|1|2|3|4|5|6|7|0x0|00:01.0|GPU-abc-123\n"
                    "gpu=1|b|1|2|3|4|5|6|7|0x0|00:02.0\n")
    assert [(g.index, g.uuid) for g in r.gpus] == [(0, "GPU-abc-123"), (1, "")]


@pytest.mark.parametrize("line", [
    "gpu=0|n|1|2|3|4|5|6|7|0x0|b|GPU-1|extra",     # 13 fields
])
def test_thirteen_fields_dropped(line):
    assert parse_probe("probe_version=2\ngpu_query=ok|1\n" + line + "\n").gpus == []


def test_uuid_must_look_like_one():
    r = parse_probe("probe_version=2\ngpu_query=ok|1\ngpu=0|a|1|2|3|4|5|6|7|0x0|b|[N/A]\n")
    assert r.gpus[0].uuid == ""


def test_mem_temp_matched_by_bus_id():
    r = parse_probe("probe_version=2\ngpu_query=ok|3\n"
                    "gpu=0|a|1|2|3|4|5|6|7|0x0|00000000:01:00.0|GPU-a\n"
                    "gpu=1|a|1|2|3|4|5|6|7|0x0|00000000:02:00.0|GPU-b\n"
                    "gpu=2|a|1|2|3|4|5|6|7|0x0|00000000:03:00.0|GPU-c\n"
                    "gpu_mem_temp=00000000:01:00.0|84\n"
                    "gpu_mem_temp=00000000:02:00.0|nan\n"
                    "gpu_mem_temp=00000000:09:00.0|70\n")
    assert [g.mem_temp for g in r.gpus] == [84.0, None, None]


@pytest.mark.parametrize("v, want", [("250", None), ("-60", None), ("200", 200.0), ("-50", -50.0),
                                     ("inf", None), ("", None)])
def test_mem_temp_range(v, want):
    r = parse_probe("probe_version=2\ngpu_query=ok|1\ngpu=0|a|1|2|3|4|5|6|7|0x0|00:01.0|GPU-a\n"
                    f"gpu_mem_temp=00:01.0|{v}\n")
    assert r.gpus[0].mem_temp == want


def test_mem_temp_bus_case_insensitive():
    r = parse_probe("probe_version=2\ngpu_query=ok|1\ngpu=0|a|1|2|3|4|5|6|7|0x0|0000:0A:00.0|GPU-a\n"
                    "gpu_mem_temp=0000:0a:00.0|71\n")
    assert r.gpus[0].mem_temp == 71.0
