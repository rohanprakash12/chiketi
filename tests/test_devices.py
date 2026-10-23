# tests/test_devices.py
"""DeviceRegistry: pairing, capabilities and per-device settings."""
from __future__ import annotations

import pytest

from chiketi.devices import (
    CODE_ALPHABET,
    MAX_DEVICES,
    MAX_PENDING,
    DeviceRegistry,
    clean_caps,
    clean_devices,
    starting_settings,
    valid_id,
)

GO = {"w": 1800, "h": 1200, "dpr": 1, "touch": True, "browser": "Chrome 155", "feed": "live"}
LCD = {"w": 1920, "h": 462, "dpr": 1, "touch": False, "browser": "Chrome 151", "feed": "picture"}


def reg(t=None):
    if t is None:
        t = [1000.0]
    return DeviceRegistry(clock=lambda: t[0]), t


def test_valid_id():
    assert valid_id("kiosk-1") and valid_id("display-a1b2c3") and valid_id("a" * 32)
    for bad in ["", "A", "a" * 33, "go kiosk", "../x", None, 5, "go_kiosk"]:
        assert not valid_id(bad), bad


def test_clean_caps_layout_and_types():
    assert clean_caps(GO)["layout"] == "landscape"
    assert clean_caps(LCD)["layout"] == "strip"
    assert clean_caps({"w": 800, "h": 1280})["layout"] == "other"
    assert clean_caps({"w": "1800", "h": True, "touch": "yes", "feed": "x"}) == {"touch": False, "feed": "live"}
    assert clean_caps("nope") == {}


def test_clean_caps_truncates_and_strips():
    c = clean_caps({"browser": "<img src=x onerror=alert(1)>" + "x" * 100})
    assert len(c["browser"]) <= 40
    assert "\n" not in clean_caps({"browser": "a\nb"})["browser"]


def test_starting_settings():
    assert starting_settings(clean_caps(GO)) == {"auto_rotate": False, "seconds": 30, "theme": "", "gear": True}
    assert starting_settings(clean_caps(LCD)) == {"auto_rotate": True, "seconds": 30, "theme": "", "gear": False}
    touch_picture = dict(GO, feed="picture")
    assert starting_settings(clean_caps(touch_picture))["auto_rotate"] is True


def test_register_pending_then_approve():
    r, _t = reg([1000.0])
    out, _changed = r.register("kiosk-1", clean_caps(GO), "192.0.2.202")
    assert out["status"] == "pending" and len(out["code"]) == 4
    assert set(out["code"]) <= set(CODE_ALPHABET)
    again, _ = r.register("kiosk-1", clean_caps(GO), "192.0.2.202")
    assert again["code"] == out["code"]                      # same request, same code
    s = r.approve("kiosk-1", "Surface Go")
    assert s == {"id": "kiosk-1", "name": "Surface Go", "auto_rotate": False, "seconds": 30,
                 "theme": "", "gear": True}
    assert r.status("kiosk-1", "192.0.2.202") == {"status": "approved", "settings": s}
    assert "kiosk-1" in r.snapshot()


def test_reject_gives_new_code():
    r, _t = reg([1000.0])
    _first, _ = r.register("display-aaaaaa", {}, "198.51.100.9")
    r.reject("display-aaaaaa")
    assert r.status("display-aaaaaa", "198.51.100.9") == {"status": "unknown"}
    second, _ = r.register("display-aaaaaa", {}, "198.51.100.9")
    assert second["status"] == "pending"


def test_unknown_after_restart_reregisters():
    r, _ = reg()
    r.register("display-bbbbbb", {}, "198.51.100.9")
    fresh = DeviceRegistry()
    fresh.load(r.snapshot())                                  # pending is not persisted
    assert fresh.status("display-bbbbbb", "198.51.100.9") == {"status": "unknown"}
    assert fresh.register("display-bbbbbb", {}, "198.51.100.9")[0]["status"] == "pending"


def test_forget_returns_to_unknown():
    r, _ = reg()
    r.register("kiosk-1", clean_caps(GO), "x")
    r.approve("kiosk-1", "Go")
    r.forget("kiosk-1")
    assert r.status("kiosk-1", "x") == {"status": "unknown"}
    with pytest.raises(KeyError):
        r.forget("kiosk-1")


def test_pending_expiry_and_cap():
    r, t = reg([0.0])
    for i in range(MAX_PENDING + 3):
        t[0] = float(i)
        r.register(f"display-{i:06d}", {}, "x")
    assert len(r.listing()["pending"]) == MAX_PENDING
    ids = {p["id"] for p in r.listing()["pending"]}
    assert "display-000000" not in ids                        # oldest dropped first
    t[0] = 25 * 3600.0
    assert r.listing()["pending"] == []                       # all older than 24 h


def test_approved_cap():
    r, _ = reg()
    for i in range(MAX_DEVICES):
        r.register(f"d-{i}", {}, "x")
        r.approve(f"d-{i}", f"D{i}")
    r.register("one-more", {}, "x")
    with pytest.raises(ValueError):
        r.approve("one-more", "Too many")


def test_self_update_limits_fields():
    r, _ = reg()
    r.register("kiosk-1", clean_caps(GO), "x")
    r.approve("kiosk-1", "Go")
    s = r.self_update("kiosk-1", {"auto_rotate": True, "seconds": 9999, "theme": "Others/Claude",
                                    "name": "hijack", "gear": False})
    assert (s["auto_rotate"], s["seconds"], s["theme"], s["name"], s["gear"]) == (True, 600, "Others/Claude", "Go", True)
    with pytest.raises(ValueError):
        r.self_update("kiosk-1", {"theme": "No/Such"})
    with pytest.raises(KeyError):
        r.self_update("stranger", {"seconds": 5})


def test_admin_update_name_and_gear():
    r, _ = reg()
    r.register("kiosk-1", clean_caps(GO), "x")
    r.approve("kiosk-1", "Go")
    s = r.admin_update("kiosk-1", {"name": "  Surface\nGo  ", "gear": False, "theme": ""})
    assert s["name"] == "Surface Go" and s["gear"] is False and s["theme"] == ""
    with pytest.raises(ValueError):
        r.admin_update("kiosk-1", {"name": ""})


def test_register_updates_caps_of_approved_device():
    r, _ = reg()
    r.register("kiosk-1", clean_caps(GO), "x")
    r.approve("kiosk-1", "Go")
    _, changed = r.register("kiosk-1", clean_caps(dict(GO, w=1200, h=1800)), "x")
    assert changed
    assert r.listing()["devices"][0]["caps"]["layout"] == "other"
    _, changed = r.register("kiosk-1", clean_caps(dict(GO, w=1200, h=1800)), "x")
    assert not changed


def test_listing_shows_seen_and_addr():
    r, _t = reg([500.0])
    r.register("kiosk-1", clean_caps(GO), "192.0.2.202")
    p = r.listing()["pending"][0]
    assert (p["id"], p["addr"], p["first_seen"], p["last_seen"], p["caps"]["touch"]) == \
        ("kiosk-1", "192.0.2.202", 500.0, 500.0, True)


def test_unknown_theme_dropped():
    out = clean_devices({"kiosk-1": {"name": "Go", "auto_rotate": False, "seconds": 30,
                                       "theme": "Panel/Removed", "gear": True}})
    assert out["kiosk-1"]["theme"] == ""


def test_clean_devices_drops_junk():
    raw = {"BAD ID": {"name": "x"}, "ok-1": "not a dict", "ok-2": {"name": "Two", "seconds": "x"}}
    raw.update({f"d-{i}": {"name": str(i)} for i in range(100)})
    out = clean_devices(raw)
    assert "BAD ID" not in out and "ok-1" not in out
    assert out["ok-2"]["seconds"] == 30
    assert len(out) == MAX_DEVICES
    assert clean_devices(None) == {}


# ── Codex review round 1 ──────────────────────────────────────────────────

def test_seen_only_tracks_known_devices():
    r, _ = reg()
    for i in range(1000):
        r.status(f"d-{i}", "x")                     # unknown ids are not remembered
    assert len(r._seen) == 0
    r.register("display-aaaaaa", {}, "x")
    r.reject("display-aaaaaa")
    r.register("kiosk-1", {}, "x")
    r.approve("kiosk-1", "Go")
    r.forget("kiosk-1")
    assert len(r._seen) == 0


def test_seen_dropped_on_eviction_and_expiry():
    r, t = reg([0.0])
    for i in range(MAX_PENDING + 5):
        t[0] = float(i)
        r.register(f"display-{i:06d}", {}, "x")
    assert len(r._seen) == MAX_PENDING
    t[0] = 30 * 3600.0
    r.listing()
    assert len(r._seen) == 0


def test_malformed_theme_types_do_not_crash():
    out = clean_devices({"ok-1": {"name": "One"}, "bad": {"theme": []}, "bad-2": {"theme": {"a": 1}}})
    assert out["ok-1"]["name"] == "One"
    assert out["bad"]["theme"] == "" and out["bad-2"]["theme"] == ""


def test_update_rejects_bad_types_and_reports_change():
    r, _ = reg()
    r.register("kiosk-1", clean_caps(GO), "x")
    r.approve("kiosk-1", "Go")
    for bad in ({"theme": []}, {"seconds": float("inf")}, {"seconds": float("nan")}, {"seconds": 1e309}):
        with pytest.raises(ValueError):
            r.self_update("kiosk-1", bad)
    s, changed = r.self_update("kiosk-1", {}, with_changed=True)
    assert changed is False
    s, changed = r.self_update("kiosk-1", {"seconds": 30}, with_changed=True)
    assert changed is False
    s, changed = r.self_update("kiosk-1", {"seconds": 45}, with_changed=True)
    assert changed is True and s["seconds"] == 45
    s, changed = r.admin_update("kiosk-1", {"name": "Go"}, with_changed=True)
    assert changed is False


# ── Codex review round 2 ──────────────────────────────────────────────────

def test_huge_integers_are_clamped_not_crashing():
    r, _ = reg()
    r.register("kiosk-1", clean_caps(GO), "x")
    r.approve("kiosk-1", "Go")
    assert r.self_update("kiosk-1", {"seconds": 10 ** 400})["seconds"] == 600
    assert r.self_update("kiosk-1", {"seconds": -(10 ** 400)})["seconds"] == 3


def test_reregister_after_expiry_keeps_fresh_sighting():
    r, t = reg([1.0])
    r.register("display-zzzzzz", {}, "198.51.100.5")
    t[0] = 90000.0
    r.register("display-zzzzzz", {}, "198.51.100.6")
    r.approve("display-zzzzzz", "Z")
    dev = r.listing()["devices"][0]
    assert (dev["last_seen"], dev["addr"]) == (90000.0, "198.51.100.6")


def test_ids_with_trailing_newline_rejected():
    for bad in ["go\n", "go\r\n", "go\n\n"]:
        assert not valid_id(bad)
