# tests/test_homelab_checks.py
from __future__ import annotations

import io
import socket
import subprocess
import urllib.error
from types import SimpleNamespace

import pytest

from chiketi.collectors.homelab.checks import (
    CheckError,
    evaluate_gateway,
    evaluate_http,
    fetch_json,
    run_probe,
)
from chiketi.collectors.homelab.config import HomelabConfig, Host

CFG = HomelabConfig(hosts=(), ssh_key="/k", known_hosts="/kh")
LINUX = Host("devbox", "linux", address="192.0.2.159", user="user")


def runner_returning(rc=0, out="probe_version=1\nkind=linux\n", err=""):
    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        return SimpleNamespace(returncode=rc, stdout=out, stderr=err)
    run.calls = calls
    return run


def test_run_probe_builds_strict_ssh_command():
    run = runner_returning()
    rep = run_probe(LINUX, CFG, runner=run)
    assert rep.kind == "linux"
    cmd = run.calls[0]
    assert cmd[0] == "ssh" and "user@192.0.2.159" in cmd
    joined = " ".join(cmd)
    for opt in ("BatchMode=yes", "StrictHostKeyChecking=yes", "UserKnownHostsFile=/kh", "ConnectTimeout=5"):
        assert opt in joined
    assert cmd[-1] == "chiketi-probe"


def test_host_key_mismatch_detail():
    run = runner_returning(rc=255, out="", err="Host key verification failed.\n")
    with pytest.raises(CheckError, match="host key mismatch"):
        run_probe(LINUX, CFG, runner=run)


def test_key_refused_detail():
    run = runner_returning(rc=255, out="", err="user@x: Permission denied (publickey).")
    with pytest.raises(CheckError, match="key refused"):
        run_probe(LINUX, CFG, runner=run)


def test_timeout():
    def run(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 20)
    with pytest.raises(CheckError, match="timed out"):
        run_probe(LINUX, CFG, runner=run)


def test_garbage_output_is_a_check_error():
    with pytest.raises(CheckError, match="unreadable"):
        run_probe(LINUX, CFG, runner=runner_returning(out="Welcome to Ubuntu!\n"))


GW = Host("pfSense", "gateway", address="192.0.2.1")


def fake_connect(reachable):
    def connect(addr, timeout=None):
        if addr[0] in reachable:
            return SimpleNamespace(close=lambda: None)
        raise OSError("no route")
    return connect


def test_gateway_all_good():
    assert evaluate_gateway(GW, connect=fake_connect({"192.0.2.1", "1.1.1.1"}),
                            resolve=lambda *a, **k: [object()]) == []


def test_gateway_down_hides_wan_checks():
    (c,) = evaluate_gateway(GW, connect=fake_connect(set()), resolve=lambda *a, **k: [])
    assert c.key == "gw" and c.severity == "crit"


def test_wan_and_dns_down():
    def no_dns(*a, **k):
        raise socket.gaierror("fail")
    conds = evaluate_gateway(GW, connect=fake_connect({"192.0.2.1"}), resolve=no_dns)
    assert {c.key for c in conds} == {"wan", "dns"}


HA = Host("Home Assistant", "http", url="http://192.0.2.30:8123/api/")


def test_http_ok_and_401():
    class Resp(io.BytesIO):
        status = 200
    assert evaluate_http(HA, opener=lambda req, timeout=None: Resp(b"{}")) == []

    def unauthorized(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)
    (c,) = evaluate_http(HA, opener=unauthorized)
    assert c.key == "down" and "401" in c.title


def test_http_unreachable():
    def refused(req, timeout=None):
        raise urllib.error.URLError("connection refused")
    (c,) = evaluate_http(HA, opener=refused)
    assert c.key == "down" and c.title == "Unreachable"


def test_fetch_json():
    class Resp(io.BytesIO):
        status = 200
    assert fetch_json("http://x/", opener=lambda req, timeout=None: Resp(b'{"a": 1}')) == {"a": 1}
    with pytest.raises(CheckError):
        fetch_json("http://x/", opener=lambda req, timeout=None: Resp(b"[1, 2]"))
