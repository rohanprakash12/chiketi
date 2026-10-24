# tests/test_homelab_rules.py
from __future__ import annotations

import pytest

from chiketi.collectors.homelab.config import DEFAULT_THRESHOLDS as THR
from chiketi.collectors.homelab.probe import Disk, Gpu, ProbeReport
from chiketi.collectors.homelab.rules import (
    HOLD_DOWN,
    Baseline,
    Condition,
    IssueTracker,
    down,
    evaluate_backup,
    evaluate_report,
    gpu_condition,
    gpu_keep_keys,
    gpu_state,
    throttling,
)


def rep(**kw) -> ProbeReport:
    base = {"version": 1, "kind": "linux", "mem_total_kb": 1000, "mem_avail_kb": 800}
    base.update(kw)
    return ProbeReport(**base)


def keys(conds):
    return {c.key: c.severity for c in conds}


def test_healthy_is_silent(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    assert evaluate_report("h", rep(filesystems={"/": 40.0}, cpu_temp_c=50.0), THR, b, 0) == []


def test_filesystem_thresholds(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    c = evaluate_report("h", rep(filesystems={"/a": 85.0, "/b": 95.0, "/c": 84.9}), THR, b, 0)
    assert keys(c) == {"fs:/a": "warn", "fs:/b": "crit"}


def test_memory_uses_available(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    assert keys(evaluate_report("h", rep(mem_avail_kb=90), THR, b, 0)) == {"mem": "warn"}
    assert keys(evaluate_report("h", rep(mem_avail_kb=40), THR, b, 0)) == {"mem": "crit"}


def test_temperatures(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    c = evaluate_report("h", rep(cpu_temp_c=96.0, gpus=[Gpu(index=0, temp=86.0, detail=False)],
                                 disks=[Disk("sda", temp_c=55.0, health="PASSED")]), THR, b, 0)
    assert keys(c) == {"cpu_temp": "crit", "gpu_temp:0": "warn", "disk_temp:sda": "warn"}


def test_smart_failed_and_rises(tmp_path):
    path = str(tmp_path / "b.json")
    b = Baseline(path)
    first = Disk("sdb", "WD", realloc=8, pending=0, health="PASSED")
    assert evaluate_report("h", rep(disks=[first]), THR, b, 0) == []   # old count = baseline, silent
    worse = Disk("sdb", "WD", realloc=10, pending=0, health="PASSED")
    assert keys(evaluate_report("h", rep(disks=[worse]), THR, b, 1)) == {"smart:sdb": "warn"}
    failed = Disk("sdb", "WD", realloc=10, pending=0, health="FAILED!")
    assert keys(evaluate_report("h", rep(disks=[failed]), THR, b, 2))["smart:sdb"] == "crit"


def test_baseline_persists(tmp_path):
    path = str(tmp_path / "b.json")
    b = Baseline(path)
    b.smart_rises("h", Disk("sdb", "WD", realloc=8))
    b.save()
    b2 = Baseline(path)
    assert b2.smart_rises("h", Disk("sdb", "WD", realloc=9)) == [("realloc", 8, 9)]


def test_corrupt_baseline_starts_fresh(tmp_path):
    p = tmp_path / "b.json"
    p.write_text("{nope")
    assert Baseline(str(p)).smart_rises("h", Disk("sda", realloc=1)) == []


def test_failed_units_and_updates(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    day = 86400
    r = rep(failed_count=2, failed_units=["a.service", "b.service"], sec_updates=3)
    assert keys(evaluate_report("h", r, THR, b, 0)) == {"units": "warn"}
    assert keys(evaluate_report("h", r, THR, b, 15 * day)) == {"units": "warn", "sec_updates": "warn"}
    # updates applied: the clock resets
    assert "sec_updates" not in keys(evaluate_report("h", rep(sec_updates=0), THR, b, 16 * day))
    assert "sec_updates" not in keys(evaluate_report("h", rep(sec_updates=2), THR, b, 17 * day))


def test_unraid(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    r = rep(kind="unraid", unraid_array="STOPPED", unraid_parity_errors=3,
            unraid_disks={"parity": "DISK_OK", "disk2": "DISK_DSBL", "parity2": "DISK_NP_DSBL"})
    assert keys(evaluate_report("Atlas", r, THR, b, 0)) == {
        "unraid_array": "crit", "unraid_disk:disk2": "crit", "unraid_parity": "warn"}


def test_titles_truncate_remote_strings(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    long = "/mnt/" + "x" * 200 + "<img src=x>"
    (c,) = evaluate_report("h", rep(filesystems={long: 99.0}), THR, b, 0)
    assert len(c.title) <= 60
    (u,) = evaluate_report("h", rep(failed_count=1, failed_units=["<b>" * 100]), THR, b, 0)
    assert len(u.detail) <= 120


def test_backup_rules():
    assert evaluate_backup({"active": False, "exit": 0, "errors": []}, THR, 0) == []
    assert keys(evaluate_backup({"active": False, "exit": 23, "errors": []}, THR, 0)) == {"backup_failed": "crit"}
    assert evaluate_backup({"active": True, "exit": 23, "errors": []}, THR, 0) == []
    thr = dict(THR, backup_max_age_h=26)
    events = "2026-10-19T11:45:57-04:00 EXIT 0\n"
    from datetime import datetime
    fin = datetime.fromisoformat("2026-10-19T11:45:57-04:00").timestamp()
    data = {"active": False, "exit": 0, "errors": [], "events": events}
    assert evaluate_backup(data, thr, fin + 25 * 3600) == []
    assert keys(evaluate_backup(data, thr, fin + 27 * 3600)) == {"backup_age": "warn"}


def test_tracker_hold_and_clear():
    t = IssueTracker()
    c = Condition("fs:/", "warn", "/ 90% full", "", 2)
    t.update("h", [c], 100)
    assert t.issues() == []                       # held
    t.update("h", [c], 130)
    (i,) = t.issues()
    assert i == {"host": "h", "severity": "warn", "title": "/ 90% full", "detail": "", "since": 100}
    t.update("h", [], 160)
    assert len(t.issues()) == 1                   # one good check is not enough
    t.update("h", [], 190)
    assert t.issues() == []


def test_blip_never_shows():
    t = IssueTracker()
    t.update("h", [Condition("mem", "crit", "m", "", 10)], 0)
    t.update("h", [], 30)
    t.update("h", [Condition("mem", "crit", "m", "", 10)], 60)
    assert t.issues() == []


def test_unreachable_freezes_other_issues():
    t = IssueTracker()
    fs = Condition("fs:/", "crit", "/ 97% full", "", 1)
    t.update("h", [fs], 0)
    for n in range(1, HOLD_DOWN + 1):
        t.update("h", [down("timed out")], n * 30, partial=True)
    titles = {i["title"] for i in t.issues()}
    assert titles == {"/ 97% full", "Unreachable"}
    assert t.host_state("h") == "crit"


def test_sorting_and_state():
    t = IssueTracker()
    t.update("a", [Condition("x", "warn", "w", "", 1)], 10)
    t.update("b", [Condition("y", "crit", "c", "", 1)], 20)
    assert [i["severity"] for i in t.issues()] == ["crit", "warn"]
    assert t.host_state("a") == "warn" and t.host_state("zzz") == "ok"


def test_unraid_space_is_judged_on_the_whole_array(tmp_path):
    """Unraid fills its data disks one after another, so one full array disk
    is normal; only the array as a whole (and cache pools, boot) count."""
    b = Baseline(str(tmp_path / "b.json"))
    r = rep(kind="unraid", filesystems={"/mnt/disk1": 97.0, "/mnt/disk12": 99.0, "/mnt/cache": 90.0},
            unraid_array_pct=70.0)
    assert keys(evaluate_report("Atlas", r, THR, b, 0)) == {"fs:/mnt/cache": "warn"}
    r = rep(kind="unraid", unraid_array_pct=88.0)
    (c,) = evaluate_report("Atlas", r, THR, b, 0)
    assert (c.key, c.severity, c.title) == ("fs:array", "warn", "Array 88% full")
    assert keys(evaluate_report("Atlas", rep(kind="unraid", unraid_array_pct=96.0), THR, b, 0)) == {"fs:array": "crit"}


def test_linux_mnt_disk_is_still_checked(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    r = rep(kind="linux", filesystems={"/mnt/disk1": 97.0})
    assert keys(evaluate_report("devbox", r, THR, b, 0)) == {"fs:/mnt/disk1": "crit"}


# ── GPUs ──────────────────────────────────────────────────────────────────

def G(**kw):
    base = dict(index=0, name="V100", util=None, vram_used=None, vram_total=None, temp=50.0,
                power=None, power_limit=None, fan=None, throttle=0, bus_id="b", procs=None, detail=True)
    base.update(kw)
    return Gpu(**base)


@pytest.mark.parametrize("util,procs,want", [
    (None, None, "unknown"), (None, 0, "unknown"), (None, 1, "busy"),
    (0, None, "unknown"), (0, 0, "idle"), (0, 1, "busy"),
    (9, None, "unknown"), (9, 0, "idle"), (9, 1, "busy"),
    (10, None, "busy"), (10, 0, "busy"), (10, 1, "busy"),
])
def test_activity_cross_product(util, procs, want):
    assert gpu_state(G(util=util, procs=procs), THR, "ok") == want


def test_state_precedence_and_boundaries():
    assert gpu_state(G(temp=99.0), THR, "offline") == "offline"
    assert gpu_state(G(temp=99.0), THR, "unreadable") == "unreadable"
    assert gpu_state(G(temp=92.0), THR, "ok") == "critical"
    assert gpu_state(G(temp=91.9), THR, "ok") == "hot"
    assert gpu_state(G(temp=85.0), THR, "ok") == "hot"
    assert gpu_state(G(temp=84.9, throttle=0x20, util=50), THR, "ok") == "throttling"
    assert gpu_state(G(throttle=0x04, util=50), THR, "ok") == "busy"           # SW power cap is normal
    assert gpu_state(G(detail=False, temp=40.0), THR, "legacy") == "nodetail"
    for bit in (0x08, 0x20, 0x40, 0x80):
        assert throttling(G(throttle=bit))
    assert not throttling(G(throttle=None))


def test_one_condition_per_gpu():
    assert gpu_condition(G(temp=95.0), THR).severity == "crit"
    c = gpu_condition(G(temp=60.0, throttle=0x40), THR)
    assert (c.key, c.severity, c.title) == ("gpu_temp:0", "warn", "GPU 0 throttling")
    assert gpu_condition(G(temp=60.0), THR) is None


def test_throttle_to_crit_never_drops_the_alert():
    t = IssueTracker()
    for i in range(4):
        t.update("gpubox", [gpu_condition(G(temp=60.0, throttle=0x20), THR)], i)
    assert t.issues()[0]["title"] == "GPU 0 throttling"
    for i in range(4, 7):                       # turns into heat: same key, raised throughout
        t.update("gpubox", [gpu_condition(G(temp=95.0, throttle=0x20), THR)], i)
        assert t.issues() and t.issues()[0]["severity"] == "crit"
    t.update("gpubox", [gpu_condition(G(temp=60.0, throttle=0x20), THR)], 7)
    assert t.issues()[0]["title"] == "GPU 0 throttling"


def test_keep_preserves_named_keys_only():
    t = IssueTracker()
    for i in range(10):
        t.update("gpubox", [gpu_condition(G(temp=95.0), THR), Condition("mem", "warn", "m", "", 1)], i)
    for i in range(10, 14):
        t.update("gpubox", [], i, keep=lambda k: k.startswith("gpu_temp:"))
    assert [x["title"] for x in t.issues()] == ["GPU 0 95°C"]      # the GPU alert stays, memory cleared


def test_keep_keys_for_missing_fields():
    r2 = ProbeReport(version=2, gpus=[G(index=0, temp=None), G(index=1, throttle=None), G(index=2)])
    assert gpu_keep_keys(r2) == {"gpu_temp:0", "gpu_temp:1"}
    legacy = ProbeReport(version=1, gpus=[G(index=0, temp=None, throttle=None, detail=False),
                                          G(index=1, temp=40.0, throttle=None, detail=False)])
    assert gpu_keep_keys(legacy) == {"gpu_temp:0"}


def test_baseline_remembers_gpus(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    b.remember_gpus("gpubox", [G(index=1, temp=70.0)], 123.0)
    b.save()
    gpus, seen = Baseline(str(tmp_path / "b.json")).gpu_memory()["gpubox"]
    assert seen == 123.0 and gpus[0].index == 1 and gpus[0].temp == 70.0
    b.forget_gpus("gpubox")
    b.save()
    assert Baseline(str(tmp_path / "b.json")).gpu_memory() == {}


@pytest.mark.parametrize("gpus", [
    '{"x": {"seen_at": "no", "gpus": [{"index": 0}]}}',
    '{"x": {"seen_at": 1, "gpus": [null]}}',
    '{"x": {"seen_at": NaN, "gpus": [{"index": 0}]}}',
    '{"x": {"seen_at": 1, "gpus": [{"index": true}]}}',
    '{"x": {"seen_at": 1, "gpus": [{"index": 0, "temp": "hot"}]}}',
    '{"x": {"seen_at": 1, "gpus": [{"index": 0, "name": 5}]}}',
    '{"x": 5}',
    '[1, 2]',
])
def test_baseline_ignores_bad_gpu_memory(tmp_path, gpus):
    p = tmp_path / "b.json"
    p.write_text('{"smart": {}, "sec": {}, "gpus": ' + gpus + '}')
    assert Baseline(str(p)).gpu_memory() == {}
