"""SessionsCollector: Claude Code sessions from a session feed, polled off-thread."""

from __future__ import annotations

import io
import json
import urllib.error

from chiketi.collectors.sessions import SessionsCollector, clean_sessions

FEED = {
    "timestamp": 1000.0,
    "host": "devbox",
    "sessions": [
        {"name": "kiosk-deploy-ef", "project": "kiosk-deploy", "state": "busy", "since": 990.0,
         "message": None, "started": 900.0},
        {"name": "nfs-e0", "project": "nfs", "state": "waiting", "since": 980.0,
         "message": "Claude needs your permission", "started": 800.0},
    ],
}


class Resp(io.BytesIO):
    status = 200


def opener_for(payload):
    def opener(req, timeout=None):
        return Resp(json.dumps(payload).encode())
    return opener


def write_cfg(tmp_path, body='url = "http://feed/api/sessions"\n'):
    p = tmp_path / "sessions.toml"
    p.write_text(body)
    return str(p)


def test_unconfigured_without_file(tmp_path):
    c = SessionsCollector(path=str(tmp_path / "none.toml"), start=False)
    assert c.collect()["sessions.status"].value == "unconfigured"


def test_invalid_config_is_unconfigured(tmp_path):
    for body in ["not toml [", 'url = "ftp://x"\n', 'url = "http://x"\npoll_seconds = 0\n']:
        c = SessionsCollector(path=write_cfg(tmp_path, body), start=False)
        assert c.collect()["sessions.status"].value == "unconfigured", body


def test_pending_then_ok(tmp_path):
    now = [2000.0]
    c = SessionsCollector(path=write_cfg(tmp_path), start=False,
                          opener=opener_for(FEED), clock=lambda: now[0])
    assert c.collect()["sessions.status"].value == "pending"
    c.poll_once()
    m = c.collect()
    assert m["sessions.status"].value == "ok"
    assert [s["name"] for s in m["sessions.list"].value] == ["kiosk-deploy-ef", "nfs-e0"]
    assert m["sessions.checked_at"].value == 2000.0
    assert m["sessions.checked_at"].extra == {"poll_seconds": 2.0, "host": "devbox"}


def test_offline_after_failures(tmp_path):
    now = [2000.0]
    ok = [True]

    def opener(req, timeout=None):
        if ok[0]:
            return Resp(json.dumps(FEED).encode())
        raise urllib.error.URLError("refused")

    c = SessionsCollector(path=write_cfg(tmp_path), start=False, opener=opener, clock=lambda: now[0])
    c.poll_once()
    ok[0] = False
    now[0] = 2005.0
    c.poll_once()
    assert c.collect()["sessions.status"].value == "ok"          # one miss is not offline
    now[0] = 2011.0
    c.poll_once()
    m = c.collect()
    assert m["sessions.status"].value == "offline"
    assert len(m["sessions.list"].value) == 2                   # last known list kept


def test_never_reachable_becomes_offline(tmp_path):
    def forbidden(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, None)
    now = [0.0]
    c = SessionsCollector(path=write_cfg(tmp_path), start=False, opener=forbidden, clock=lambda: now[0])
    c.poll_once()
    assert c.collect()["sessions.status"].value == "pending"     # just started
    now[0] = 100.0
    c.poll_once()
    m = c.collect()
    assert m["sessions.status"].value == "offline"                 # e.g. not on the feed's allowlist
    assert m["sessions.list"].value == []


def test_clean_sessions_drops_junk_and_caps():
    raw = [
        "nope", None, {"name": 5},
        {"name": "a" * 500, "project": "<b>p</b>", "state": "weird", "since": "x", "message": 7},
    ] + [{"name": f"s{i}", "state": "idle", "since": 1.0} for i in range(100)]
    out = clean_sessions(raw)
    assert len(out) == 50
    first = out[0]
    assert len(first["name"]) == 64 and first["state"] == "idle"
    assert first["since"] is None and first["message"] is None
    assert first["project"] == "<b>p</b>"        # escaping is the renderer's job
    assert clean_sessions({"not": "a list"}) == []


def test_clean_sessions_counts():
    out = clean_sessions([
        {"name": "a", "tokens": 4100170, "agents": 2},
        {"name": "b", "tokens": -1, "agents": "3"},
        {"name": "c", "tokens": float("nan"), "agents": True},
        {"name": "d"},
    ])
    assert [(s["tokens"], s["agents"]) for s in out] == [(4100170, 2), (None, None), (None, None), (None, None)]


def test_clean_sessions_tool():
    out = clean_sessions([{"name": "a", "tool": "codex"}, {"name": "b", "tool": "<x>"}, {"name": "c"}])
    assert [s["tool"] for s in out] == ["codex", "claude", "claude"]
