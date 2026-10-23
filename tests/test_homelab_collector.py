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
