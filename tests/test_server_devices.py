# tests/test_server_devices.py
"""Device routes: self-service for displays (no token), admin for the panel (token)."""
from __future__ import annotations

import json
import urllib.error
import urllib.request

import pytest

from chiketi import server
from chiketi.devices import DeviceRegistry
from tests.test_server import _LiveServer

GO_CAPS = {"w": 1800, "h": 1200, "touch": True, "browser": "Chrome 155", "feed": "live"}


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(server, "DEVICES", DeviceRegistry())
    monkeypatch.setattr(server, "_persist", lambda: None)
    monkeypatch.setattr(server, "_AUTH_TOKEN", "secret")
    _cancel_timer()                                           # none left by another test
    monkeypatch.setattr(server, "_SELF_SERVICE_PERSIST_DELAY", 0.2)
    yield
    _cancel_timer()


def _cancel_timer():
    t = server._persist_timer
    if t is not None:
        t.cancel()
    server._persist_timer = None
    server._persist_dirty = False


def call(srv, method, path, body=None, token=False, origin=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Chiketi-Token"] = "secret"
    if origin:
        headers["Origin"] = origin
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(srv.url(path), data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


def test_register_needs_no_token_and_returns_code():
    with _LiveServer() as srv:
        out = call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        assert out["status"] == "pending" and len(out["code"]) == 4
        assert call(srv, "GET", "/api/device/kiosk-1")["code"] == out["code"]


def test_register_rejects_bad_id_and_foreign_origin():
    with _LiveServer() as srv:
        with pytest.raises(urllib.error.HTTPError) as e:
            call(srv, "POST", "/api/register", {"id": "Bad Id", "caps": {}})
        assert e.value.code == 400
        with pytest.raises(urllib.error.HTTPError) as e:
            call(srv, "POST", "/api/register", {"id": "kiosk-1"}, origin="http://evil.example")
        assert e.value.code == 403


def test_approve_needs_token_then_display_gets_settings():
    with _LiveServer() as srv:
        call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        with pytest.raises(urllib.error.HTTPError) as e:
            call(srv, "POST", "/api/devices/kiosk-1/approve", {"name": "Surface Go"})
        assert e.value.code == 403
        s = call(srv, "POST", "/api/devices/kiosk-1/approve", {"name": "Surface Go"}, token=True)
        assert s["auto_rotate"] is False and s["gear"] is True
        st = call(srv, "GET", "/api/device/kiosk-1")
        assert st["status"] == "approved" and st["settings"]["name"] == "Surface Go"


def test_self_update_without_token_admin_with_token():
    with _LiveServer() as srv:
        call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        call(srv, "POST", "/api/devices/kiosk-1/approve", {"name": "Go"}, token=True)
        s = call(srv, "POST", "/api/device/kiosk-1", {"seconds": 45, "name": "ignored"})
        assert s["seconds"] == 45 and s["name"] == "Go"
        s = call(srv, "POST", "/api/devices/kiosk-1", {"name": "Surface Go"}, token=True)
        assert s["name"] == "Surface Go"
        with pytest.raises(urllib.error.HTTPError) as e:
            call(srv, "POST", "/api/device/stranger", {"seconds": 5})
        assert e.value.code == 404


def test_forget_then_status_unknown():
    with _LiveServer() as srv:
        call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        call(srv, "POST", "/api/devices/kiosk-1/approve", {"name": "Go"}, token=True)
        call(srv, "POST", "/api/devices/kiosk-1/forget", {}, token=True)
        assert call(srv, "GET", "/api/device/kiosk-1") == {"status": "unknown"}


def test_reject_and_listing():
    with _LiveServer() as srv:
        call(srv, "POST", "/api/register", {"id": "display-abc123", "caps": {}})
        listing = call(srv, "GET", "/api/devices")
        assert [p["id"] for p in listing["pending"]] == ["display-abc123"]
        assert listing["pending"][0]["addr"] == "127.0.0.1"
        call(srv, "POST", "/api/devices/display-abc123/reject", {}, token=True)
        assert call(srv, "GET", "/api/devices")["pending"] == []


def test_other_posts_still_need_token():
    with _LiveServer() as srv:
        with pytest.raises(urllib.error.HTTPError) as e:
            call(srv, "POST", "/api/display", {})
        assert e.value.code == 403
        with pytest.raises(urllib.error.HTTPError) as e:
            call(srv, "POST", "/api/devices/kiosk-1", {"name": "x"})
        assert e.value.code == 403


def test_no_op_updates_do_not_write_state(monkeypatch):
    writes = []
    monkeypatch.setattr(server, "_persist", lambda: writes.append(1))
    with _LiveServer() as srv:
        call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        call(srv, "POST", "/api/devices/kiosk-1/approve", {"name": "Go"}, token=True)
        n = len(writes)
        for _ in range(5):
            call(srv, "POST", "/api/device/kiosk-1", {})
            call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        assert len(writes) == n
        call(srv, "POST", "/api/device/kiosk-1", {"seconds": 45})
        import time as _time
        _time.sleep(0.6)                       # self-service writes are coalesced
        assert len(writes) == n + 1


def test_malformed_update_is_400_not_dropped_connection():
    with _LiveServer() as srv:
        call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        call(srv, "POST", "/api/devices/kiosk-1/approve", {"name": "Go"}, token=True)
        for bad in ({"theme": []}, {"name": []}):
            with pytest.raises(urllib.error.HTTPError) as e:
                call(srv, "POST", "/api/devices/kiosk-1", bad, token=True)
            assert e.value.code == 400


def test_huge_integer_seconds_is_clamped_over_http():
    with _LiveServer() as srv:
        call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        call(srv, "POST", "/api/devices/kiosk-1/approve", {"name": "Go"}, token=True)
        data = ('{"seconds": ' + "9" * 401 + "}").encode()
        req = urllib.request.Request(srv.url("/api/device/kiosk-1"), data=data, method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as r:
            assert json.loads(r.read())["seconds"] == 600


def test_self_service_writes_are_coalesced(monkeypatch):
    import time as _time
    writes = []
    monkeypatch.setattr(server, "_persist", lambda: writes.append(1))
    monkeypatch.setattr(server, "_SELF_SERVICE_PERSIST_DELAY", 0.3)
    with _LiveServer() as srv:
        call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        call(srv, "POST", "/api/devices/kiosk-1/approve", {"name": "Go"}, token=True)
        n = len(writes)
        for i in range(20):
            call(srv, "POST", "/api/register",
                 {"id": "kiosk-1", "caps": dict(GO_CAPS, w=1800 + (i % 2))})
            call(srv, "POST", "/api/device/kiosk-1", {"seconds": 30 + 5 * (i % 2)})
        _time.sleep(1.0)
        assert 1 <= len(writes) - n <= 3


def test_blocked_write_keeps_one_worker_and_saves_latest(monkeypatch):
    """A slow disk must not pile up a waiting write per delay window; the
    newest state must still reach disk once it frees up."""
    import threading as _th
    import time as _time
    gate = _th.Event()
    saved = []

    def slow_persist():
        gate.wait(5)
        saved.append(server.DEVICES.snapshot()["kiosk-1"]["seconds"])

    monkeypatch.setattr(server, "_SELF_SERVICE_PERSIST_DELAY", 0.05)
    with _LiveServer() as srv:
        call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        call(srv, "POST", "/api/devices/kiosk-1/approve", {"name": "Go"}, token=True)
        monkeypatch.setattr(server, "_persist", slow_persist)
        for i in range(12):
            call(srv, "POST", "/api/device/kiosk-1", {"seconds": 30 + 5 * (i % 2) + i})
            _time.sleep(0.06)
        workers = [t for t in _th.enumerate() if isinstance(t, _th.Timer) and t.is_alive()]
        assert len(workers) <= 1
        gate.set()
        _time.sleep(0.5)
        assert 1 <= len(saved) <= 2
        assert saved[-1] == server.DEVICES.snapshot()["kiosk-1"]["seconds"]


def test_change_during_write_gets_a_follow_up_flush(monkeypatch):
    """The write snapshots first, then blocks; a change made meanwhile must
    reach disk in exactly one follow-up flush."""
    import threading as _th
    import time as _time
    gate = _th.Event()
    saved = []

    def slow_persist():
        saved.append(server.DEVICES.snapshot()["kiosk-1"]["seconds"])   # snapshot first
        if len(saved) == 1:
            gate.wait(5)

    monkeypatch.setattr(server, "_SELF_SERVICE_PERSIST_DELAY", 0.05)
    with _LiveServer() as srv:
        call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        call(srv, "POST", "/api/devices/kiosk-1/approve", {"name": "Go"}, token=True)
        monkeypatch.setattr(server, "_persist", slow_persist)
        call(srv, "POST", "/api/device/kiosk-1", {"seconds": 40})
        _time.sleep(0.2)                            # first flush has snapshotted 40, now blocked
        call(srv, "POST", "/api/device/kiosk-1", {"seconds": 55})
        gate.set()
        _time.sleep(0.4)
        assert saved == [40, 55]
