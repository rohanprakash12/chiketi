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


SELF_DEFAULT = ["screen1", "screen2", "screen3", "screen4", "screen5"]


def test_starting_settings():
    assert starting_settings(clean_caps(GO)) == {"auto_rotate": False, "seconds": 30, "theme": "", "gear": True,
                                                 "mode": "self", "screens": SELF_DEFAULT}
    assert starting_settings(clean_caps(LCD))["auto_rotate"] is True
    assert starting_settings(clean_caps(GO), kiosk=True)["mode"] == "kiosk"
    assert starting_settings(clean_caps(GO), kiosk=True)["screens"] == ["lab", "sessions", "gpus"]
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
                 "theme": "", "gear": True, "mode": "self", "screens": SELF_DEFAULT}
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
    got = (s["auto_rotate"], s["seconds"], s["theme"], s["name"], s["gear"])
    assert got == (True, 600, "Others/Claude", "Go", True)
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


# ── Modes and screens ──────────────────────────────────────────────────────

def approved(r, dev_id="kiosk-1", caps=GO):
    r.register(dev_id, clean_caps(caps), "192.0.2.202")
    return r.approve(dev_id, "Go")


def test_new_display_mode_follows_kiosk_capability():
    r, _ = reg()
    assert approved(r)["mode"] == "self"
    r2, _ = reg()
    r2.kiosk_capable = True
    s = approved(r2)
    assert s["mode"] == "kiosk" and s["screens"] == ["lab", "sessions", "gpus"]


def test_admin_sets_mode_and_screens():
    r, _ = reg()
    r.kiosk_capable = True
    approved(r)
    out = r.admin_update("kiosk-1", {"screens": ["sessions", "overview", "lab"]})
    assert out["screens"] == ["sessions", "overview", "lab"]
    out = r.admin_update("kiosk-1", {"mode": "self"})
    assert out["mode"] == "self" and out["screens"] == SELF_DEFAULT
    out = r.admin_update("kiosk-1", {"mode": "kiosk", "screens": []})
    assert out["mode"] == "kiosk" and out["screens"] == []
    out = r.admin_update("kiosk-1", {"mode": "kiosk"})              # not a change: screens kept
    assert out["screens"] == []


@pytest.mark.parametrize("body", [
    {"mode": "tv"}, {"mode": 1}, {"screens": "lab"}, {"screens": ["lab", "lab"]},
    {"screens": ["screen1"]}, {"screens": ["zzz"]}, {"screens": [None]},
    {"screens": ["lab"] * 17}, {"mode": "self", "screens": ["lab"]},
])
def test_bad_mode_or_screens_rejected_and_nothing_changes(body):
    r, _ = reg()
    r.kiosk_capable = True
    approved(r)
    before = r.snapshot()
    with pytest.raises(ValueError):
        r.admin_update("kiosk-1", dict(body, seconds=99))
    assert r.snapshot() == before


def test_mode_switch_clears_unsupported_theme():
    r, _ = reg()
    approved(r)                                                      # self
    r.admin_update("kiosk-1", {"theme": "Vintage/Tubes"})
    out = r.admin_update("kiosk-1", {"mode": "kiosk"})
    assert out["theme"] == "" and out["screens"] == ["lab", "sessions", "gpus"]
    r.admin_update("kiosk-1", {"mode": "self", "theme": "Vintage/Tubes"})
    out = r.admin_update("kiosk-1", {"mode": "kiosk", "screens": ["sessions"]})   # with screens too
    assert out["theme"] == "" and out["screens"] == ["sessions"]
    r.admin_update("kiosk-1", {"theme": "Others/Claude"})
    assert r.admin_update("kiosk-1", {"mode": "self"})["theme"] == "Others/Claude"   # allowed: kept


def test_supplied_unsupported_theme_rejects():
    r, _ = reg()
    r.kiosk_capable = True
    approved(r)
    before = r.snapshot()
    with pytest.raises(ValueError):
        r.admin_update("kiosk-1", {"theme": "Vintage/Tubes"})
    with pytest.raises(ValueError):
        r.admin_update("kiosk-1", {"mode": "kiosk", "screens": ["lab"], "theme": "Vintage/VFD"})
    assert r.snapshot() == before
    assert r.admin_update("kiosk-1", {"mode": "self", "theme": "Vintage/VFD"})["theme"] == "Vintage/VFD"


def test_self_service_cannot_change_mode_or_screens():
    r, _ = reg()
    r.kiosk_capable = True
    approved(r)
    out = r.self_update("kiosk-1", {"mode": "self", "screens": ["screen1"], "seconds": 40})
    assert out["mode"] == "kiosk" and out["screens"] == ["lab", "sessions", "gpus"] and out["seconds"] == 40
    # The theme is checked against the STORED mode, not the ignored one in the body.
    with pytest.raises(ValueError):
        r.self_update("kiosk-1", {"mode": "self", "theme": "Vintage/Tubes"})
    assert r.snapshot()["kiosk-1"]["theme"] == ""


def test_ensure_local():
    r, _ = reg()
    assert r.ensure_local("demo-host") is True
    s = r.listing()["devices"][0]
    assert (s["id"], s["name"], s["mode"], s["auto_rotate"], s["gear"]) == ("local", "demo-host", "self", True, False)
    r.admin_update("local", {"seconds": 45, "name": "Desk"})
    assert r.ensure_local("demo-host") is False
    assert r.snapshot()["local"]["seconds"] == 45 and r.snapshot()["local"]["name"] == "Desk"
    assert r.status("local", "127.0.0.1")["status"] == "approved"


def test_local_survives_full_registry():
    r, _ = reg()
    for i in range(MAX_DEVICES):
        r.register(f"d-{i}", {}, "192.0.2.5")
        r.approve(f"d-{i}", f"D{i}")
    r.ensure_local("demo-host")
    r.admin_update("local", {"seconds": 45})
    again, _ = reg()
    again.load(clean_devices(r.snapshot()))
    assert again.snapshot()["local"]["seconds"] == 45
    assert len(again.snapshot()) == MAX_DEVICES + 1
    r.register("d-extra", {}, "192.0.2.5")
    with pytest.raises(ValueError):                               # local does not count, 32 others do
        r.approve("d-extra", "Extra")


def test_load_migrates_devices_without_mode():
    old = {"go": {"name": "Go", "auto_rotate": False, "seconds": 20, "theme": "Sci-Fi/TOS", "gear": True,
                  "caps": GO},
           "wide": {"name": "Wide", "auto_rotate": True, "seconds": 30, "theme": "Vintage/Tubes",
                    "gear": False, "caps": LCD},
           "bad": {"name": "Bad", "mode": "tv", "screens": ["lab"], "caps": {}},
           "kept": {"name": "Kept", "mode": "kiosk", "screens": ["sessions", "zzz", "sessions"], "caps": {}}}
    r, _ = reg()
    r.kiosk_capable = True
    r.load(old)
    s = r.snapshot()
    assert (s["go"]["mode"], s["go"]["screens"], s["go"]["seconds"], s["go"]["theme"]) == \
        ("kiosk", ["lab", "sessions", "gpus"], 20, "Sci-Fi/TOS")
    assert (s["wide"]["mode"], s["wide"]["theme"]) == ("kiosk", "")          # Tubes is not a Kiosk theme (yet)
    assert (s["bad"]["mode"], s["bad"]["screens"]) == ("kiosk", ["lab", "sessions", "gpus"])
    assert s["kept"]["screens"] == ["sessions"]
    r2, _ = reg()                                                            # no Kiosk data in this house
    r2.load(old)
    assert r2.snapshot()["go"]["mode"] == "self"
    assert r2.snapshot()["wide"]["theme"] == "Vintage/Tubes"


def test_clean_devices_keeps_missing_mode_as_none():
    out = clean_devices({"go": {"name": "Go", "caps": {}}})
    assert out["go"]["mode"] is None and out["go"]["screens"] is None
    out = clean_devices({"go": {"name": "Go", "mode": "self", "screens": ["screen2"], "caps": {}}})
    assert out["go"]["mode"] == "self" and out["go"]["screens"] == ["screen2"]
    out = clean_devices({"go": {"name": "Go", "mode": "kiosk", "theme": "Vintage/Tubes", "caps": {}}})
    assert out["go"]["theme"] == ""


def test_rotate_interval_seeds_new_devices(monkeypatch):
    import dataclasses

    from chiketi import devices
    monkeypatch.setattr(devices, "TIMING", dataclasses.replace(devices.TIMING, rotate_interval_s=12))
    r, _ = reg()
    assert approved(r)["seconds"] == 12
    r.load({"old": {"name": "Old", "seconds": 50, "caps": {}}})
    assert r.snapshot()["old"]["seconds"] == 50


def test_saved_screens_survive_new_defaults():
    r, _ = reg()
    r.kiosk_capable = True
    r.load({"wide": {"name": "Wide", "mode": "kiosk", "screens": ["lab", "sessions"], "caps": {}}})
    assert r.snapshot()["wide"]["screens"] == ["lab", "sessions"]


# Phase 1 of the Kiosk looks: these themes draw the Kiosk screens.
KIOSK_LOOKS_1 = ["Sci-Fi/TNG", "Sci-Fi/DS9", "Terminal/cyan", "Terminal/amber", "Terminal/phosphor",
                 "Terminal/red_alert", "Terminal/blue", "Terminal/hacker", "Terminal/Arch", "Terminal/Ubuntu",
                 "Terminal/openSUSE", "Terminal/Mandriva",
                 "Vintage/Scanlines", "Vintage/VFD"]


@pytest.mark.parametrize("theme", KIOSK_LOOKS_1)
def test_kiosk_device_keeps_each_new_look_across_a_restart(theme):
    r, _ = reg()
    r.kiosk_capable = True
    approved(r)
    out = r.admin_update("kiosk-1", {"mode": "kiosk", "screens": ["gpus", "lab"], "theme": theme})
    assert (out["mode"], out["theme"], out["screens"]) == ("kiosk", theme, ["gpus", "lab"])
    fresh, _ = reg()
    fresh.kiosk_capable = True
    fresh.load(r.snapshot())                                  # what state.json holds
    s = fresh.snapshot()["kiosk-1"]
    assert (s["mode"], s["theme"], s["screens"]) == ("kiosk", theme, ["gpus", "lab"])
