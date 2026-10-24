# tests/test_homelab_collector.py
from __future__ import annotations

from chiketi.collectors.homelab.checks import CheckError
from chiketi.collectors.homelab.collector import HomelabCollector
from chiketi.collectors.homelab.config import HomelabConfig, Host
from chiketi.collectors.homelab.poller import HomelabPoller
from chiketi.collectors.homelab.probe import ProbeReport
from chiketi.collectors.homelab.rules import HOLD_DOWN, Baseline, Condition

HOSTS = (
    Host("Atlas", "unraid", address="z", user="root", backup_api="http://z/api"),
    Host("devbox", "linux", address="w", user="user"),
    Host("pfSense", "gateway", address="g"),
    Host("Home Assistant", "http", url="http://ha/api/"),
)


def make(tmp_path, probe, gateway=lambda h: [], http=lambda h: [], fetch=lambda url: {"exit": 0}):
    cfg = HomelabConfig(hosts=HOSTS, poll_seconds=30)
    clock = iter(range(0, 100000, 30))
    return HomelabPoller(cfg, Baseline(str(tmp_path / "b.json")), clock=lambda: next(clock),
                         probe=probe, gateway=gateway, http=http, fetch=fetch)


def healthy(host, cfg):
    return ProbeReport(version=1, kind=host.kind, mem_total_kb=100, mem_avail_kb=80, filesystems={"/": 10.0})


def test_snapshot_before_first_poll(tmp_path):
    snap = make(tmp_path, healthy).snapshot()
    assert snap["checked_at"] is None
    assert [h["state"] for h in snap["hosts"]] == ["unknown"] * 4


def test_all_healthy(tmp_path):
    p = make(tmp_path, healthy)
    p.poll_once()
    snap = p.snapshot()
    assert snap["issues"] == [] and snap["checked_at"] == 0
    assert [h["state"] for h in snap["hosts"]] == ["ok"] * 4


def test_unreachable_after_hold(tmp_path):
    def probe(host, cfg):
        if host.name == "devbox":
            raise CheckError("timed out")
        return healthy(host, cfg)
    p = make(tmp_path, probe)
    for _ in range(HOLD_DOWN):
        p.poll_once()
    (i,) = p.snapshot()["issues"]
    assert (i["host"], i["title"], i["detail"]) == ("devbox", "Unreachable", "timed out")


def test_backup_failure_on_nas(tmp_path):
    p = make(tmp_path, healthy, fetch=lambda url: {"active": False, "exit": 23, "errors": []})
    p.poll_once()
    (i,) = p.snapshot()["issues"]
    assert i["host"] == "Atlas" and i["title"] == "Backup failed"


def test_backup_api_down_is_a_warning(tmp_path):
    def fetch(url):
        raise CheckError("status unavailable: refused")
    p = make(tmp_path, healthy, fetch=fetch)
    for _ in range(HOLD_DOWN):
        p.poll_once()
    (i,) = p.snapshot()["issues"]
    assert i["severity"] == "warn" and i["title"] == "Backup status unavailable"


def test_a_crashing_rule_skips_that_host_only(tmp_path):
    def probe(host, cfg):
        if host.name == "devbox":
            raise RuntimeError("bug")
        return healthy(host, cfg)
    p = make(tmp_path, probe)
    p.poll_once()
    states = {h["name"]: h["state"] for h in p.snapshot()["hosts"]}
    assert states["Atlas"] == "ok"


def test_gateway_issue(tmp_path):
    p = make(tmp_path, healthy, gateway=lambda h: [Condition("wan", "crit", "Internet unreachable", "", 1)])
    p.poll_once()
    assert p.snapshot()["issues"][0]["host"] == "pfSense"


def test_collector_unconfigured(tmp_path):
    c = HomelabCollector(path=str(tmp_path / "missing.toml"))
    m = c.collect()
    assert m["homelab.status"].value == "unconfigured"


def test_collector_invalid_config_is_unconfigured(tmp_path):
    p = tmp_path / "homelab.toml"
    p.write_text("not toml [")
    assert HomelabCollector(path=str(p)).collect()["homelab.status"].value == "unconfigured"


def test_collector_status_levels(tmp_path):
    p = tmp_path / "homelab.toml"
    p.write_text("[[host]]\nname='pfSense'\nkind='gateway'\naddress='g'\n")
    c = HomelabCollector(path=str(p), start=False)
    assert c.collect()["homelab.status"].value == "pending"
    c._poller._gateway = lambda h: [Condition("wan", "crit", "x", "", 1)]
    c._poller.poll_once()
    m = c.collect()
    assert m["homelab.status"].value == "crit"
    assert m["homelab.checked_at"].extra["poll_seconds"] == 30.0
    assert m["homelab.hosts"].value == [{"name": "pfSense", "state": "crit"}]


# ── GPUs ──────────────────────────────────────────────────────────────────
from chiketi.collectors.homelab.probe import Gpu, parse_probe  # noqa: E402
from chiketi.collectors.homelab.rules import HOLD_TEMP  # noqa: E402

GPU_HOSTS = (Host("gpubox", "linux", address="g", user="u"), Host("devbox", "linux", address="w", user="u"))


def gmake(tmp_path, probe, hosts=GPU_HOSTS, poll=30, **kw):
    cfg = HomelabConfig(hosts=hosts, poll_seconds=poll)
    clock = iter(range(0, 100000, 30))
    return HomelabPoller(cfg, Baseline(str(tmp_path / "b.json")), clock=lambda: next(clock), probe=probe, **kw)


def v2(gpus, query="ok", rows=None, tool=None, mem_avail=80):
    r = ProbeReport(version=2, kind="linux", mem_total_kb=100, mem_avail_kb=mem_avail)
    r.gpus = gpus
    r.gpu_tool = tool
    r.gpu_query = query
    r.gpu_rows = len(gpus) if rows is None else rows
    r.gpu_procs_query = "ok"
    return r


NOGPU = v2([], tool="absent", query=None)


def gpu(i, **kw):
    base = dict(index=i, name="V100", util=50.0, vram_used=1.0, vram_total=32768.0, temp=60.0,
                power=100.0, power_limit=250.0, fan=None, throttle=0, bus_id=f"b{i}", procs=1)
    base.update(kw)
    return Gpu(**base)


def only_gpubox(seq):
    it = iter(seq)

    def probe(h, c):
        if h.name != "gpubox":
            return NOGPU
        r = next(it)
        if isinstance(r, Exception):
            raise r
        return r
    return probe


def gpu_issue(p, i=0):
    return [x for x in p.snapshot()["issues"] if x["title"].startswith(f"GPU {i}")]


def collector_for(p):
    c = HomelabCollector.__new__(HomelabCollector)
    c._poller = p
    return c


def test_gpu_rows_and_order(tmp_path):
    p = gmake(tmp_path, only_gpubox([v2([gpu(1), gpu(0)])]))
    p.poll_once()
    s = p.snapshot()
    assert [(r["host"], r["index"], r["state"]) for r in s["gpus"]] == [("gpubox", 0, "busy"), ("gpubox", 1, "busy")]
    assert s["gpu_hosts"] == [{"host": "gpubox", "outcome": "ok"}, {"host": "devbox", "outcome": "none"}]


def test_offline_keeps_rows_with_age(tmp_path):
    p = gmake(tmp_path, only_gpubox([v2([gpu(0)]), CheckError("timed out")]))
    p.poll_once()
    seen = p.snapshot()["gpus"][0]["seen_at"]
    p.poll_once()
    row = p.snapshot()["gpus"][0]
    assert row["state"] == "offline" and row["seen_at"] == seen


def test_unreadable_and_rejected_lines(tmp_path):
    p = gmake(tmp_path, only_gpubox([v2([gpu(0), gpu(1)]), v2([], query="fail"), v2([gpu(0)], rows=2)]))
    p.poll_once()
    for _ in range(2):
        p.poll_once()
        s = p.snapshot()
        assert [r["state"] for r in s["gpus"]] == ["unreadable", "unreadable"]
        assert s["gpu_hosts"][0]["outcome"] == "unreadable"


def test_removed_card_goes_only_after_full_ok(tmp_path):
    p = gmake(tmp_path, only_gpubox([v2([gpu(0), gpu(1)]), v2([gpu(0)])]))
    p.poll_once()
    p.poll_once()
    assert [r["index"] for r in p.snapshot()["gpus"]] == [0]


def test_tool_absent_for_known_host_is_unreadable(tmp_path):
    p = gmake(tmp_path, only_gpubox([v2([gpu(0)]), NOGPU]))
    p.poll_once()
    p.poll_once()
    assert p.snapshot()["gpu_hosts"][0]["outcome"] == "unreadable"
    assert p.snapshot()["gpus"][0]["state"] == "unreadable"


def test_v2_without_markers_is_unreadable(tmp_path):
    bare = v2([], query=None)
    p = gmake(tmp_path, only_gpubox([bare]))
    p.poll_once()
    s = p.snapshot()
    assert s["gpu_hosts"][0] == {"host": "gpubox", "outcome": "unreadable"} and s["gpus"] == []
    p2 = gmake(tmp_path / "x", only_gpubox([v2([gpu(0)]), bare]))
    (tmp_path / "x").mkdir()
    p2.poll_once()
    p2.poll_once()
    assert p2.snapshot()["gpus"][0]["state"] == "unreadable"


def legacy(temps):
    return parse_probe("probe_version=1\nkind=linux\n" + "".join(f"gpu_temp_c={t}\n" for t in temps))


def test_legacy_rows_before_redeploy(tmp_path):
    p = gmake(tmp_path, only_gpubox([legacy([70])] + [legacy([88])] * HOLD_TEMP))
    p.poll_once()
    s = p.snapshot()
    assert s["gpu_hosts"][0]["outcome"] == "legacy"
    assert [(r["state"], r["temp"], r["detail"]) for r in s["gpus"]] == [("nodetail", 70.0, False)]
    assert collector_for(p).collect()["homelab.gpus"].value[0]["state"] == "nodetail"
    for _ in range(HOLD_TEMP):
        p.poll_once()
    row = collector_for(p).collect()["homelab.gpus"].value[0]
    assert (row["state"], row["detail"]) == ("hot", False)
    assert [(i["severity"], i["title"]) for i in gpu_issue(p)] == [("warn", "GPU 0 88°C")]


def test_legacy_losing_temps_for_known_host_is_unreadable(tmp_path):
    p = gmake(tmp_path, only_gpubox([legacy([70]), legacy([]), legacy([71])]))
    outcomes = []
    for _ in range(3):
        p.poll_once()
        outcomes.append(p.snapshot()["gpu_hosts"][0]["outcome"])
    assert outcomes == ["legacy", "unreadable", "legacy"]


def test_restart_during_outage(tmp_path):
    p = gmake(tmp_path, only_gpubox([v2([gpu(0)])]))
    p.poll_once()
    again = gmake(tmp_path, only_gpubox([CheckError("no connection")]))   # same baseline file
    s = again.snapshot()
    assert s["published_at"] is None                                    # metrics wait for a poll
    assert s["gpu_hosts"][0] == {"host": "gpubox", "outcome": "offline"}
    assert [(r["host"], r["state"]) for r in s["gpus"]] == [("gpubox", "offline")]
    again.poll_once()
    s = again.snapshot()
    assert [(r["host"], r["state"]) for r in s["gpus"]] == [("gpubox", "offline")]
    assert s["gpu_hosts"][0]["outcome"] == "offline"


def test_pending_at_start(tmp_path):
    p = gmake(tmp_path, only_gpubox([]))
    assert p.snapshot()["gpu_hosts"] == [{"host": "gpubox", "outcome": "pending"},
                                         {"host": "devbox", "outcome": "pending"}]
    assert p.snapshot()["gpus"] == []


def test_gpu_alert_survives_unreadable_and_na(tmp_path):
    seq = ([v2([gpu(0, temp=95.0)])] * 4 + [v2([], query="fail")] * 3 +
           [v2([gpu(0, temp=None)])] * 3 + [v2([gpu(0, temp=60.0)])] * 2)
    p = gmake(tmp_path, only_gpubox(seq))
    for _ in range(4):
        p.poll_once()
    assert [i["title"] for i in gpu_issue(p)] == ["GPU 0 95°C"]
    for _ in range(6):
        p.poll_once()
        assert gpu_issue(p), "the alert dropped on a failed query or an N/A reading"
    p.poll_once()
    assert gpu_issue(p)                          # one healthy reading is not enough
    p.poll_once()
    assert not gpu_issue(p)


def test_throttle_mask_lost_keeps_throttling_alert(tmp_path):
    seq = [v2([gpu(0, throttle=0x20)])] * 4 + [v2([gpu(0, throttle=None)])] * 3 + [v2([gpu(0, throttle=0)])] * 2
    p = gmake(tmp_path, only_gpubox(seq))
    for _ in range(4):
        p.poll_once()
    assert [i["title"] for i in gpu_issue(p)] == ["GPU 0 throttling"]
    for _ in range(3):
        p.poll_once()
        assert gpu_issue(p)
    p.poll_once()
    assert gpu_issue(p)
    p.poll_once()
    assert not gpu_issue(p)


def test_one_gpu_unknown_other_recovers(tmp_path):
    seq = [v2([gpu(0, temp=95.0), gpu(1, temp=95.0)])] * 4 + [v2([gpu(0, temp=None), gpu(1, temp=60.0)])] * 2
    p = gmake(tmp_path, only_gpubox(seq))
    for _ in range(4):
        p.poll_once()
    assert gpu_issue(p, 0) and gpu_issue(p, 1)
    for _ in range(2):
        p.poll_once()
    assert gpu_issue(p, 0) and not gpu_issue(p, 1)


def test_unreadable_keeps_gpu_alerts_but_clears_other_issues(tmp_path):
    seq = [v2([gpu(0, temp=95.0)], mem_avail=1)] * 10 + [v2([], query="fail", mem_avail=80)] * 2
    p = gmake(tmp_path, only_gpubox(seq))
    for _ in range(10):
        p.poll_once()
    titles = {i["title"] for i in p.snapshot()["issues"]}
    assert "GPU 0 95°C" in titles and any(t.startswith("Memory") for t in titles)
    for _ in range(2):
        p.poll_once()
    titles = {i["title"] for i in p.snapshot()["issues"]}
    assert titles == {"GPU 0 95°C"}


def test_oscillation(tmp_path):
    seq = [v2([gpu(0, temp=t)]) for t in [84.0, 86.0] * 4]
    p = gmake(tmp_path, only_gpubox(seq))
    for _ in range(8):
        p.poll_once()
        assert not gpu_issue(p)                   # never raised from a clean start
    seq2 = ([v2([gpu(0, temp=86.0)])] * 4 + [v2([gpu(0, temp=t)]) for t in [84.0, 86.0] * 3]
            + [v2([gpu(0, temp=60.0)])] * 2)
    q = gmake(tmp_path / "y", only_gpubox(seq2))
    (tmp_path / "y").mkdir()
    for _ in range(4):
        q.poll_once()
    assert gpu_issue(q)
    for _ in range(6):
        q.poll_once()
        assert gpu_issue(q)
    for _ in range(2):
        q.poll_once()
    assert not gpu_issue(q)


def test_offline_cycle_keeps_alert(tmp_path):
    seq = [v2([gpu(0, temp=95.0)])] * 4 + [CheckError("no connection")] + [v2([gpu(0, temp=60.0)])] * 2
    p = gmake(tmp_path, only_gpubox(seq))
    for _ in range(5):
        p.poll_once()
    assert gpu_issue(p)
    p.poll_once()
    assert gpu_issue(p)
    p.poll_once()
    assert not gpu_issue(p)


def test_two_gpus_one_alerted_both_recover(tmp_path):
    seq = [v2([gpu(0, temp=95.0), gpu(1, temp=60.0)])] * 4 + [v2([gpu(0, temp=60.0), gpu(1, temp=60.0)])] * 2
    p = gmake(tmp_path, only_gpubox(seq))
    for _ in range(4):
        p.poll_once()
    assert gpu_issue(p, 0) and not gpu_issue(p, 1)
    for _ in range(2):
        p.poll_once()
    assert p.snapshot()["issues"] == []


def test_publication_times_and_staleness(tmp_path):
    hosts = tuple(Host(f"h{i}", "linux", address="a", user="u") for i in range(12))
    wall = iter([0.0, 71.0])                     # poll starts: 0, then 60 s poll + 11 s max wait
    mono = iter([0.0, 60.0, 100.0, 160.0])       # each poll lasts 60 s (two batches of 30 s)
    cfg = HomelabConfig(hosts=hosts, poll_seconds=10)
    p = HomelabPoller(cfg, Baseline(str(tmp_path / "b.json")), clock=lambda: next(wall),
                      mono=lambda: next(mono), probe=lambda h, c: NOGPU)
    c = collector_for(p)
    p.poll_once()
    a = c.collect()["homelab.gpus"].extra
    assert a["published_at"] == 60.0                       # the END of the poll, not its start
    assert c.collect()["homelab.gpus"].extra["published_at"] == 60.0
    after = a["stale_after"]
    assert after == 2 * (1.1 * 10 + 2 * 40)
    assert 130.9 - a["published_at"] < after               # fresh right before the next publication
    p.poll_once()
    b = c.collect()["homelab.gpus"].extra
    assert b["published_at"] == 131.0
    assert (131.0 + after + 1) - b["published_at"] > after


def test_collector_gpu_metrics_wait_for_first_poll(tmp_path):
    p = gmake(tmp_path, only_gpubox([v2([gpu(0)])]))
    c = collector_for(p)
    assert c.collect()["homelab.gpus"].available is False
    p.poll_once()
    m = c.collect()
    assert m["homelab.gpus"].available and m["homelab.gpu_hosts"].available
    assert m["homelab.gpus"].extra["warn_c"] == 85.0 and m["homelab.gpus"].extra["crit_c"] == 92.0
