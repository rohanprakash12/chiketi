# Device Registration, Pairing and the Control-Panel Hub (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every display that opens chiketi registers as a device, new ones show a pairing code
until approved in the control panel, and the control panel becomes the hub: a device drop-down
scopes the theme and auto-rotate/seconds to one display.

**Architecture:** A pure-Python `DeviceRegistry` (`chiketi/devices.py`) holds approved devices
(persisted in `state.json` under `devices`) and pending pairing requests (memory only). The
server exposes self-service routes for displays (register, poll, no token) and token-gated
admin routes for the control panel. The display page gains a small ES5 pairing script that
runs first: it works out the device id and capabilities, registers, shows the pairing page
while pending, and starts the existing dashboard app once approved. The dashboard then applies
the device's own theme and rotation settings.

**Tech Stack:** Python ≥ 3.11 stdlib only; ES2017 browser JS (ES5 for the pairing script);
Node + playwright-core for the real-browser checks.

**Spec:** `specs/2026-10-21-device-settings-design.md`, Phase 1. Read it before starting.

## Global Constraints

- psutil stays the only runtime dependency; no new Python packages.
- `chiketi/assets/ui/display_app.js`, `control_app.js`, `screen_functions.js`: ES2017, no build step.
- `chiketi/assets/ui/pairing.js`: **ES5 only** (no `let`/`const`, arrow functions, template
  literals, `fetch`, `Promise`, classes) so it runs on browsers too old for chiketi. It must not
  use CSS container queries.
- Device ids: 1–32 characters of `a-z 0-9 -`. Random ids: `display-` + 6 characters of `a-z0-9`.
- Pairing codes: 4 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I/L), displayed
  as `XX-XX`.
- Pending requests: at most 16, dropped when not seen for 24 hours. Approved devices: at most 32.
- `seconds`: clamped to 3–600, default 30.
- Starting settings on approval: touch (and not a picture feed) → `auto_rotate` false,
  `gear` true; otherwise `auto_rotate` true, `gear` false; `seconds` 30, `theme` "".
- Minimum browser text, verbatim: "This browser is too old: needs Chrome 105+, Safari 16+ or Firefox 110+".
- Self-service routes (`POST /api/register`, `GET`/`POST /api/device/<id>`) need **no token**
  but keep the existing Host and Origin checks. Every other POST keeps the token check.
- Every remote string reaching HTML goes through `esc()` (or the ES5 equivalent in pairing.js).
- Back up deployed files before overwriting them (`*.bak-YYYYMMDD`).
- Don't run `ruff format`; run `.venv/bin/ruff check` on new and changed Python files.
- Commit after every task with these trailers:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01FoFFf4K4CUrdH6HPDArPdC`.

## Review Focus

1. **chiketi-server restarts while a display is pending.** Pending requests live in memory, so they
   are lost. The display must get `status: "unknown"` on its next poll and register again (new
   code), not hang. Pinned by `test_unknown_after_restart_reregisters` (Task 1) and the browser
   check's "server forgets pending" step (Task 4).
2. **A device is forgotten while it shows dashboards.** It must return to the pairing page
   within one poll. Pinned by `test_forget_then_status_unknown` (Task 3) and the browser check
   (Task 4).
3. **Hostile capability strings.** A user agent or name containing `<img src=x onerror=…>`
   must be truncated in Python and escaped on the pairing page and in the control panel. Pinned
   by `test_clean_caps_truncates_and_strips` (Task 1) and the hostile-UA browser step (Task 4).
4. **A device's saved theme no longer exists** (renamed or removed). The display must fall back
   to the house theme, never render blank. Pinned by `test_unknown_theme_dropped` (Task 1) and
   `test_state_devices_round_trip` (Task 2).
5. **A hand-edited state file with junk devices** (bad ids, wrong types, 100 entries). Bad
   entries are dropped, the cap of 32 holds, and boot never fails. Pinned by
   `test_state_devices_sanitized` (Task 2).

---

## File structure

| Path | Responsibility |
|---|---|
| `chiketi/devices.py` | create: ids, codes, capability cleaning, starting settings, `DeviceRegistry` |
| `chiketi/state.py` | modify: `devices` in `DEFAULT_STATE` and `_sanitize` |
| `chiketi/server.py` | modify: registry global, load/persist, device routes, token exemption, `__PAIRING_JS__` |
| `chiketi/assets/ui/pairing.js` | create: ES5 id/caps/registration/pairing page; starts the app when approved |
| `chiketi/assets/ui/display.html` | modify: pairing container and script before the app |
| `chiketi/assets/ui/display_app.js` | modify: start on approval, per-device theme and rotation, remove `?rotate=off` |
| `chiketi/assets/ui/control.html`, `control_app.js`, `control.css` | modify: device bar, pending list, device settings |
| `tests/test_devices.py`, `tests/test_server_devices.py` | create: unit and route tests |
| `tests/test_state.py` | modify: devices round trip and sanitizing |
| `scripts/devices_check.mjs` | create: real-browser pairing and control-panel check |
| kiosk-deploy `kiosk-1/shell.html`, `chiketi-server/lcd-snap/lcd_snap.py` | modify: device ids (rollout) |

---

### Task 1: The device registry

**Files:**
- Create: `chiketi/devices.py`
- Test: `tests/test_devices.py`

**Interfaces:**
- Produces:
  - `valid_id(x) -> bool`
  - `clean_caps(raw) -> dict` with keys among `w, h, dpr, touch, browser, feed, layout`
  - `starting_settings(caps) -> dict` `{auto_rotate, seconds, theme, gear}`
  - `clean_devices(raw) -> dict[str, dict]` (for state loading)
  - `class DeviceRegistry(clock=time.time)` with methods `load(devices)`, `snapshot() -> dict`,
    `register(id, caps, addr) -> (dict, bool changed)`, `status(id, addr) -> dict`,
    `self_update(id, body) -> dict`, `admin_update(id, body) -> dict`,
    `approve(id, name) -> dict`, `reject(id)`, `forget(id)`, `listing() -> dict`.
    Status dicts: `{"status": "pending", "code": "K7Q2"}`, `{"status": "unknown"}`, or
    `{"status": "approved", "settings": {id, name, auto_rotate, seconds, theme, gear}}`.
    `self_update`/`admin_update`/`approve`/`reject`/`forget` raise `KeyError` for an unknown
    id and `ValueError` for bad input.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_devices.py
"""DeviceRegistry: pairing, capabilities and per-device settings."""
from __future__ import annotations

import pytest

from chiketi.devices import (
    CODE_ALPHABET, MAX_DEVICES, MAX_PENDING, DeviceRegistry, clean_caps, clean_devices,
    starting_settings, valid_id,
)

GO = {"w": 1800, "h": 1200, "dpr": 1, "touch": True, "browser": "Chrome 155", "feed": "live"}
LCD = {"w": 1920, "h": 462, "dpr": 1, "touch": False, "browser": "Chrome 151", "feed": "picture"}


def reg(t=[1000.0]):
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
    r, t = reg([1000.0])
    out, changed = r.register("kiosk-1", clean_caps(GO), "192.0.2.202")
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
    r, t = reg([1000.0])
    first, _ = r.register("display-aaaaaa", {}, "198.51.100.9")
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
    r, t = reg([500.0])
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
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `.venv/bin/python -m pytest tests/test_devices.py -q`
Expected: ERROR, `ModuleNotFoundError: No module named 'chiketi.devices'`.

- [ ] **Step 3: Write `chiketi/devices.py`**

```python
"""Displays registered with this chiketi: pairing, capabilities, per-device settings.

A display that chiketi has not approved is *pending*: it shows a pairing code
until someone approves it in the control panel. Approved devices are saved in
state.json; pending requests live only in memory (they are cheap to recreate:
a display whose request was lost just registers again and gets a new code).

Pairing keeps the device list tidy and intentional. It is not access control:
/display and /api/metrics stay readable on the LAN, as before.
"""

from __future__ import annotations

import re
import secrets
import threading
import time

from chiketi.themes import THEMES

ID_RE = re.compile(r"^[a-z0-9-]{1,32}$")
CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"   # no 0/O/1/I/L
MAX_PENDING = 16
MAX_DEVICES = 32
PENDING_TTL = 24 * 3600
SECONDS_MIN, SECONDS_MAX, SECONDS_DEFAULT = 3, 600, 30
_NAME_MAX = 40
_BROWSER_MAX = 40
_PRINTABLE = re.compile(r"[^\x20-\x7e]")
# Frame height in kiosk units (1024 wide), as shared_helpers.js classifies it.
_LANDSCAPE = (576, 770)
_STRIP_MAX = 341


def valid_id(x) -> bool:
    return isinstance(x, str) and bool(ID_RE.match(x))


def _text(v, limit: int) -> str:
    if not isinstance(v, str):
        return ""
    return " ".join(_PRINTABLE.sub(" ", v).split())[:limit]


def _int(v, lo: int, hi: int):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        n = int(v)
    except (OverflowError, ValueError):
        return None
    return n if lo <= n <= hi else None


def clean_caps(raw) -> dict:
    """Keep only well-formed capability fields; derive the layout class."""
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    w, h = _int(raw.get("w"), 1, 20000), _int(raw.get("h"), 1, 20000)
    if w and h:
        out["w"], out["h"] = w, h
        frame = 1024 * h / w
        out["layout"] = ("landscape" if _LANDSCAPE[0] <= frame <= _LANDSCAPE[1]
                         else "strip" if frame <= _STRIP_MAX else "other")
    dpr = raw.get("dpr")
    if isinstance(dpr, (int, float)) and not isinstance(dpr, bool) and 0.5 <= dpr <= 8:
        out["dpr"] = round(float(dpr), 2)
    out["touch"] = raw.get("touch") is True
    browser = _text(raw.get("browser"), _BROWSER_MAX)
    if browser:
        out["browser"] = browser
    out["feed"] = "picture" if raw.get("feed") == "picture" else "live"
    return out


def starting_settings(caps: dict) -> dict:
    touch = bool(caps.get("touch")) and caps.get("feed") != "picture"
    return {"auto_rotate": not touch, "seconds": SECONDS_DEFAULT, "theme": "", "gear": touch}


def _apply(rec: dict, body: dict, fields: tuple) -> None:
    """Validate the WHOLE body first, then change rec. Raises ValueError."""
    new = {}
    if "auto_rotate" in fields and "auto_rotate" in body:
        if not isinstance(body["auto_rotate"], bool):
            raise ValueError("auto_rotate must be true or false")
        new["auto_rotate"] = body["auto_rotate"]
    if "seconds" in fields and "seconds" in body:
        n = body["seconds"]
        if isinstance(n, bool) or not isinstance(n, (int, float)):
            raise ValueError("seconds must be a number")
        new["seconds"] = max(SECONDS_MIN, min(SECONDS_MAX, int(n)))
    if "theme" in fields and "theme" in body:
        th = body["theme"]
        if th != "" and th not in THEMES:
            raise ValueError("unknown theme")
        new["theme"] = th
    if "gear" in fields and "gear" in body:
        if not isinstance(body["gear"], bool):
            raise ValueError("gear must be true or false")
        new["gear"] = body["gear"]
    if "name" in fields and "name" in body:
        name = _text(body["name"], _NAME_MAX)
        if not name:
            raise ValueError("name must not be empty")
        new["name"] = name
    rec.update(new)


def _clean_record(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    rec = {"name": _text(raw.get("name"), _NAME_MAX) or "Display",
           **starting_settings({}), "caps": clean_caps(raw.get("caps"))}
    for key, ok in (("auto_rotate", lambda v: isinstance(v, bool)),
                    ("gear", lambda v: isinstance(v, bool)),
                    ("theme", lambda v: v == "" or v in THEMES)):
        if key in raw and ok(raw[key]):
            rec[key] = raw[key]
    secs = _int(raw.get("seconds"), SECONDS_MIN, SECONDS_MAX)
    if secs is not None:
        rec["seconds"] = secs
    return rec


def clean_devices(raw) -> dict:
    """Saved devices from state.json: bad entries dropped, at most MAX_DEVICES."""
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    for dev_id, rec in raw.items():
        if len(out) >= MAX_DEVICES:
            break
        if not valid_id(dev_id):
            continue
        clean = _clean_record(rec)
        if clean is not None:
            out[dev_id] = clean
    return out


class DeviceRegistry:
    """Approved devices (persisted by the caller via snapshot()) and pending
    pairing requests (memory only). Thread-safe: request threads share it."""

    def __init__(self, clock=time.time):
        self._lock = threading.Lock()
        self._clock = clock
        self._devices: dict[str, dict] = {}
        self._pending: dict[str, dict] = {}
        self._seen: dict[str, tuple[float, str]] = {}

    def load(self, devices) -> None:
        with self._lock:
            self._devices = clean_devices(devices)

    def snapshot(self) -> dict:
        with self._lock:
            return {k: {**v, "caps": dict(v["caps"])} for k, v in self._devices.items()}

    def _public(self, dev_id: str) -> dict:
        d = self._devices[dev_id]
        return {"id": dev_id, "name": d["name"], "auto_rotate": d["auto_rotate"],
                "seconds": d["seconds"], "theme": d["theme"], "gear": d["gear"]}

    def _expire(self, now: float) -> None:
        for dev_id in [k for k, p in self._pending.items() if now - p["last_seen"] > PENDING_TTL]:
            del self._pending[dev_id]

    def _new_code(self) -> str:
        used = {p["code"] for p in self._pending.values()}
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(4))
            if code not in used:
                return code

    def register(self, dev_id: str, caps: dict, addr: str) -> tuple[dict, bool]:
        """A display announces itself. Returns (status dict, changed-saved-state)."""
        now = self._clock()
        with self._lock:
            self._seen[dev_id] = (now, addr)
            if dev_id in self._devices:
                changed = self._devices[dev_id]["caps"] != caps
                self._devices[dev_id]["caps"] = dict(caps)
                return {"status": "approved", "settings": self._public(dev_id)}, changed
            self._expire(now)
            p = self._pending.get(dev_id)
            if p is None:
                if len(self._pending) >= MAX_PENDING:
                    oldest = min(self._pending, key=lambda k: self._pending[k]["last_seen"])
                    del self._pending[oldest]
                p = self._pending[dev_id] = {"code": self._new_code(), "first_seen": now}
            p.update(caps=dict(caps), addr=addr, last_seen=now)
            return {"status": "pending", "code": p["code"]}, False

    def status(self, dev_id: str, addr: str) -> dict:
        """A display's poll. Unknown means 'register again'."""
        now = self._clock()
        with self._lock:
            self._seen[dev_id] = (now, addr)
            if dev_id in self._devices:
                return {"status": "approved", "settings": self._public(dev_id)}
            self._expire(now)
            p = self._pending.get(dev_id)
            if p is None:
                return {"status": "unknown"}
            p["last_seen"], p["addr"] = now, addr
            return {"status": "pending", "code": p["code"]}

    def self_update(self, dev_id: str, body: dict) -> dict:
        with self._lock:
            rec = self._devices[dev_id]
            _apply(rec, body, ("auto_rotate", "seconds", "theme"))
            return self._public(dev_id)

    def admin_update(self, dev_id: str, body: dict) -> dict:
        with self._lock:
            rec = self._devices[dev_id]
            _apply(rec, body, ("auto_rotate", "seconds", "theme", "gear", "name"))
            return self._public(dev_id)

    def approve(self, dev_id: str, name: str) -> dict:
        with self._lock:
            p = self._pending[dev_id]
            if len(self._devices) >= MAX_DEVICES:
                raise ValueError(f"at most {MAX_DEVICES} devices")
            rec = {"name": "Display", **starting_settings(p["caps"]), "caps": dict(p["caps"])}
            _apply(rec, {"name": name}, ("name",))
            self._devices[dev_id] = rec
            del self._pending[dev_id]
            return self._public(dev_id)

    def reject(self, dev_id: str) -> None:
        with self._lock:
            del self._pending[dev_id]

    def forget(self, dev_id: str) -> None:
        with self._lock:
            del self._devices[dev_id]

    def listing(self) -> dict:
        now = self._clock()
        with self._lock:
            self._expire(now)
            devices = []
            for dev_id in self._devices:
                seen, addr = self._seen.get(dev_id, (None, ""))
                devices.append({**self._public(dev_id), "caps": dict(self._devices[dev_id]["caps"]),
                                "last_seen": seen, "addr": addr})
            pending = [{"id": k, "code": p["code"], "caps": dict(p["caps"]), "addr": p["addr"],
                        "first_seen": p["first_seen"], "last_seen": p["last_seen"]}
                       for k, p in self._pending.items()]
            return {"devices": devices, "pending": pending, "now": now}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `.venv/bin/python -m pytest tests/test_devices.py -q && .venv/bin/ruff check chiketi/devices.py tests/test_devices.py`
Expected: all pass; ruff clean.

- [ ] **Step 5: Commit**

```bash
git add chiketi/devices.py tests/test_devices.py
git commit -m "feat(devices): device registry -- pairing codes, capabilities, per-device settings"
```

---

### Task 2: Save approved devices in state.json

**Files:**
- Modify: `chiketi/state.py` (`DEFAULT_STATE`, `_defaults`, `_sanitize`)
- Test: `tests/test_state.py`

**Interfaces:**
- Consumes: `clean_devices(raw)` (Task 1).
- Produces: `load_state()["devices"]` is always a dict of clean device records; `save_state()`
  writes whatever `devices` the snapshot carries.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_state.py`; it already imports
  `load_state`, `save_state` and uses `tmp_path`/`monkeypatch` with `XDG_CONFIG_HOME` — follow
  the file's existing fixture for pointing state at `tmp_path`)

```python
def test_state_devices_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    from chiketi.state import load_state, save_state
    dev = {"kiosk-1": {"name": "Surface Go", "auto_rotate": False, "seconds": 30,
                         "theme": "Others/Claude", "gear": True,
                         "caps": {"w": 1800, "h": 1200, "touch": True}}}
    assert save_state({"devices": dev})
    got = load_state()["devices"]["kiosk-1"]
    assert (got["name"], got["auto_rotate"], got["theme"], got["caps"]["layout"]) == \
        ("Surface Go", False, "Others/Claude", "landscape")


def test_state_devices_sanitized(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    import json, os
    from chiketi.state import load_state, state_path
    os.makedirs(os.path.dirname(state_path()), exist_ok=True)
    junk = {"BAD": {}, "x-1": [], **{f"d-{i}": {"name": "n", "seconds": 10 ** 400} for i in range(100)}}
    with open(state_path(), "w") as f:
        json.dump({"version": 1, "devices": junk}, f)
    devices = load_state()["devices"]
    assert len(devices) == 32 and "BAD" not in devices and "x-1" not in devices
    assert devices["d-0"]["seconds"] == 30


def test_state_without_devices_defaults_empty(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    from chiketi.state import load_state
    assert load_state()["devices"] == {}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `.venv/bin/python -m pytest tests/test_state.py -q -k devices`
Expected: FAIL with `KeyError: 'devices'`.

- [ ] **Step 3: Implement**

In `chiketi/state.py`:
- add `from chiketi.devices import clean_devices` below the `THEMES` import;
- add `"devices": {},` to `DEFAULT_STATE` (after `"height": 600,`);
- in `_defaults()`, after `out["screen_rotation"] = {}` add `out["devices"] = {}`;
- at the end of `_sanitize`, before `return out`, add
  `out["devices"] = clean_devices(raw.get("devices"))`.

Check that `save_state` writes the keys it is given (read it; if it filters keys through
`_sanitize` before writing, that already covers `devices`).

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_state.py -q && .venv/bin/ruff check chiketi/state.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chiketi/state.py tests/test_state.py
git commit -m "feat(state): persist approved devices"
```

---

### Task 3: Device routes on the server

**Files:**
- Modify: `chiketi/server.py`
- Test: `tests/test_server_devices.py`

**Interfaces:**
- Consumes: `DeviceRegistry`, `valid_id`, `clean_caps` (Task 1); state `devices` (Task 2).
- Produces (HTTP):
  - `POST /api/register` body `{id, caps}` → status dict (no token)
  - `GET /api/device/<id>` → status dict (no token)
  - `POST /api/device/<id>` body subset of `{auto_rotate, seconds, theme}` → settings (no token;
    404 if not approved)
  - `GET /api/devices` → `{devices, pending, now}`
  - `POST /api/devices/<id>/approve` `{name}`, `POST /api/devices/<id>/reject`,
    `POST /api/devices/<id>/forget`, `POST /api/devices/<id>` (admin fields) — token required
  - module global `server.DEVICES` (a `DeviceRegistry`)

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `.venv/bin/python -m pytest tests/test_server_devices.py -q`
Expected: FAIL (`AttributeError: ... has no attribute 'DEVICES'`).

- [ ] **Step 3: Implement in `chiketi/server.py`**

(a) Imports and the registry, next to the other module globals (after `_PERSIST_LOCK`):
```python
from chiketi.devices import DeviceRegistry, clean_caps, valid_id

# Displays registered with this server (see chiketi/devices.py).
DEVICES = DeviceRegistry()
```

(b) In `apply_saved_state`, inside the `with _STATE_LOCK:` block, at its end:
```python
        DEVICES.load(saved.get("devices"))
```

(c) In `_persist`, add to the snapshot dict: `"devices": DEVICES.snapshot(),`

(d) In `do_POST`, the token check must not apply to the display's own routes. Replace
```python
        # Optional shared-secret gate on state-changing requests.
        if _AUTH_TOKEN and not _token_matches(self.headers.get("X-Chiketi-Token")):
            self.send_error(403, "Forbidden")
            return
        parsed = self._parse_target()
        if parsed is None:
            return
        path = parsed.path
```
with
```python
        parsed = self._parse_target()
        if parsed is None:
            return
        path = parsed.path
        # A display registers and changes its own settings without the token
        # (the owner's call: no lock on a kiosk's own options). Host and Origin are
        # still checked above, so another web page cannot do it.
        self_service = path == "/api/register" or path.startswith("/api/device/")
        # Optional shared-secret gate on state-changing requests.
        if (_AUTH_TOKEN and not self_service
                and not _token_matches(self.headers.get("X-Chiketi-Token"))):
            self.send_error(403, "Forbidden")
            return
        if self_service or path.startswith("/api/devices/"):
            self._device_post(path)
            return
```

(e) In `do_GET`, before the final `else: self.send_error(404)`, add:
```python
        elif route.startswith("/api/device/"):
            dev_id = route[len("/api/device/"):]
            if not valid_id(dev_id):
                self.send_error(400, "Invalid device id")
                return
            self._json_response(DEVICES.status(dev_id, self.client_address[0]))
        elif route == "/api/devices":
            self._json_response(DEVICES.listing())
```

(f) Add the POST dispatcher as a `ControlHandler` method (after `do_POST`):
```python
    def _device_post(self, path: str) -> None:
        body = self._read_body()
        if body is None:
            return
        addr = self.client_address[0]
        try:
            if path == "/api/register":
                dev_id = body.get("id")
                if not valid_id(dev_id):
                    self.send_error(400, "Invalid device id")
                    return
                out, changed = DEVICES.register(dev_id, clean_caps(body.get("caps")), addr)
                if changed:
                    _persist()
                self._json_response(out)
                return
            if path.startswith("/api/device/"):
                dev_id = path[len("/api/device/"):]
                if not valid_id(dev_id):
                    self.send_error(400, "Invalid device id")
                    return
                out = DEVICES.self_update(dev_id, body)
            else:
                rest = path[len("/api/devices/"):]
                dev_id, _, action = rest.partition("/")
                if not valid_id(dev_id):
                    self.send_error(400, "Invalid device id")
                    return
                if action == "approve":
                    out = DEVICES.approve(dev_id, body.get("name"))
                elif action == "reject":
                    DEVICES.reject(dev_id)
                    out = {"ok": True}
                elif action == "forget":
                    DEVICES.forget(dev_id)
                    out = {"ok": True}
                elif action == "":
                    out = DEVICES.admin_update(dev_id, body)
                else:
                    self.send_error(404)
                    return
        except KeyError:
            self.send_error(404, "No such device")
            return
        except ValueError as exc:
            self.send_error(400, str(exc))
            return
        _persist()
        self._json_response(out)
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_server_devices.py tests/test_server.py -q && .venv/bin/ruff check tests/test_server_devices.py`
Expected: PASS. (`chiketi/server.py` has pre-existing ruff findings; check only that you added
none: `.venv/bin/ruff check chiketi/server.py | grep -c .` is not higher than before.)

- [ ] **Step 5: Commit**

```bash
git add chiketi/server.py tests/test_server_devices.py
git commit -m "feat(server): device registration, pairing and per-device settings routes"
```

---

### Task 4: Pairing page and per-device behaviour on the display

**Files:**
- Create: `chiketi/assets/ui/pairing.js`
- Modify: `chiketi/assets/ui/display.html`, `chiketi/assets/ui/display_app.js`,
  `chiketi/server.py` (`_build_display_html`, `_DISPLAY_ASSETS`)
- Test: `scripts/devices_check.mjs` (real browser), `tests/test_server.py` (page contains the script)

**Interfaces:**
- Consumes: routes from Task 3.
- Produces (browser globals):
  - `window.chiketiDevice` — `{id, settings}` once approved
  - `window.chiketiRegister()` — re-sends id + caps (the app calls it when the frame changes)
  - `window.chiketiStart(settings)` — defined by `display_app.js`; pairing.js calls it once
    approved (or sets `window.CHIKETI_PENDING_START` if the app has not loaded yet)
  - `window.chiketiApplyDevice(settings)` — defined by `display_app.js`; updates the running app

- [ ] **Step 1: Write the failing page test** (append to `tests/test_server.py`)

```python
def test_display_page_carries_pairing_script():
    with _LiveServer() as srv:
        with urllib.request.urlopen(srv.url("/display"), timeout=5) as resp:
            page = resp.read().decode()
    assert 'id="pairing"' in page
    assert "chiketiRegister" in page
    assert page.index("chiketiRegister") < page.index("function poll(")   # pairing runs first
```

Run: `.venv/bin/python -m pytest tests/test_server.py -q -k pairing_script`
Expected: FAIL.

- [ ] **Step 2: Write `chiketi/assets/ui/pairing.js`** (ES5 only)

```js
/* Pairing: runs before the dashboard app, in ES5, so even a browser too old
   for chiketi gets a readable page. Works out this display's id and
   capabilities, registers, shows a pairing code while pending, and starts
   the app (window.chiketiStart) once the control panel approves it. */
(function () {
  var API = window.location.origin;
  var params = {};
  window.location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
  });
  var ID_RE = /^[a-z0-9-]{1,32}$/;
  var root = document.getElementById('pairing');
  var app = document.getElementById('display');
  var started = false, pollTimer = null, house = null;

  function escH(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function deviceId() {
    if (params.device && ID_RE.test(params.device)) return params.device;
    var id = null;
    try { id = window.localStorage.getItem('chiketi.device'); } catch (e) { id = null; }
    if (!id || !ID_RE.test(id)) {
      var abc = 'abcdefghijklmnopqrstuvwxyz0123456789', s = 'display-';
      for (var i = 0; i < 6; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
      id = s;
      try { window.localStorage.setItem('chiketi.device', id); } catch (e) { /* this page only */ }
    }
    return id;
  }
  var ID = deviceId();

  function browserName() {
    var ua = navigator.userAgent, m;
    if ((m = ua.match(/Edg\/(\d+)/))) return 'Edge ' + m[1];
    if ((m = ua.match(/Firefox\/(\d+)/))) return 'Firefox ' + m[1];
    if ((m = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) return 'Chrome ' + m[1];
    if ((m = ua.match(/Version\/(\d+).*Safari/))) return 'Safari ' + m[1];
    return 'Browser';
  }
  function caps() {
    var touch = (navigator.maxTouchPoints || 0) > 0 ||
      !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    return { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1,
             touch: touch, browser: browserName(),
             feed: params.feed === 'picture' ? 'picture' : 'live' };
  }
  function capsText(c) {
    var f = 1024 * c.h / c.w;
    var shape = (f >= 576 && f <= 770) ? 'landscape' : (f <= 341 ? 'strip' : 'no layout yet');
    return c.w + '×' + c.h + ' · ' + shape + ' · ' +
      (c.touch ? 'touch' : 'no touch') + ' · ' + c.browser +
      (c.feed === 'picture' ? ' · picture feed' : '');
  }
  function supported() {
    return !!(window.CSS && CSS.supports && CSS.supports('container-type', 'inline-size'));
  }

  function xhr(method, path, body, cb) {
    var r = new XMLHttpRequest();
    r.open(method, API + path);
    r.timeout = 5000;
    if (body) r.setRequestHeader('Content-Type', 'application/json');
    r.onload = function () {
      var j = null;
      try { j = JSON.parse(r.responseText); } catch (e) { j = null; }
      cb(r.status === 200 ? j : null);
    };
    r.onerror = r.ontimeout = function () { cb(null); };
    r.send(body ? JSON.stringify(body) : null);
  }

  function show(html) {
    var bg = house ? house.background : '#000', fg = house ? house.primary : '#ccc';
    var dim = house ? house.dim : '#888';
    // No `inset`, `gap` or `min()` without a fallback: this page must render on
    // browsers older than chiketi supports, to tell them so.
    root.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;text-align:center;' +
      'font-family:sans-serif;background:' + bg + ';color:' + fg;
    document.body.style.background = bg;
    root.innerHTML = html.replace(/\{dim\}/g, dim);
    root.hidden = false;
    app.style.display = 'none';
  }
  function showPending(code) {
    var c = caps();
    show('<div style="letter-spacing:.3em;font-size:4vw;font-size:min(4vw,7vh)">NEW DISPLAY</div>' +
      '<div style="font-weight:700;letter-spacing:.12em;font-size:16vw;font-size:min(16vw,34vh);line-height:1">' +
        escH(code.slice(0, 2) + '-' + code.slice(2)) + '</div>' +
      '<div style="font-size:2.6vw;font-size:min(2.6vw,5vh)">Approve in the chiketi control panel at ' +
        escH(window.location.host) + '</div>' +
      '<div style="font-size:2vw;font-size:min(2vw,4vh);color:{dim}">' + escH(capsText(c)) +
        ' · ' + escH(ID) + '</div>');
  }
  function showTooOld() {
    show('<div style="font-size:4vw;font-size:min(4vw,8vh)">This browser is too old: needs Chrome 105+, ' +
      'Safari 16+ or Firefox 110+</div><div style="font-size:2vw;font-size:min(2vw,4vh);color:{dim}">' +
      escH(capsText(caps())) + '</div>');
  }

  function start(settings) {
    window.chiketiDevice = { id: ID, settings: settings };
    if (started) {
      if (window.chiketiApplyDevice) window.chiketiApplyDevice(settings);
      return;
    }
    started = true;
    root.hidden = true;
    root.innerHTML = '';
    app.style.display = '';
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (window.chiketiStart) window.chiketiStart(settings);
    else window.CHIKETI_PENDING_START = settings;
  }

  function handle(out) {
    if (!out) return;
    if (out.status === 'approved') start(out.settings);
    else if (out.status === 'pending') {
      if (started) { window.location.reload(); return; }   // forgotten: back to pairing
      showPending(out.code);
      if (!pollTimer) pollTimer = setInterval(poll, 3000);
    } else if (out.status === 'unknown') {
      if (started) { window.location.reload(); return; }
      register();
    }
  }
  function register() {
    xhr('POST', '/api/register', { id: ID, caps: caps() }, handle);
  }
  function poll() { xhr('GET', '/api/device/' + ID, null, handle); }
  window.chiketiRegister = register;
  window.chiketiPollDevice = function () { xhr('GET', '/api/device/' + ID, null, handle); };

  xhr('GET', '/api/themes', null, function (t) {
    if (t && t.families && t.families[t.active_family]) house = t.families[t.active_family][t.active_variant];
    if (!supported()) { showTooOld(); return; }
    register();
  });
})();
```

- [ ] **Step 3: Wire it into the page**

`chiketi/assets/ui/display.html` — replace the body with:
```html
<body>
<div id="display"></div>
<div id="pairing" hidden></div>
<script>__PAIRING_JS__</script>

__DISPLAY_SCRIPTS__
</body>
```

`chiketi/server.py`:
- add `"pairing.js"` to `_DISPLAY_ASSETS`;
- in `_build_display_html`, add `.replace("__PAIRING_JS__", _ui_asset("pairing.js"))` to the
  `html` chain, before `.replace("__DISPLAY_SCRIPTS__", scripts)` (so a `__…__` token inside the
  app scripts is never confused with it).

- [ ] **Step 4: Per-device behaviour in `display_app.js`**

(a) Replace the two `AUTO_ROTATE` lines (the comment block and
`const AUTO_ROTATE = new URLSearchParams(location.search).get('rotate') !== 'off';  // this page's code; see _display_build() in server.py`)
with:
```js
/* This display's own settings, from the control panel or its Settings screen
   (see pairing.js). null only before approval. */
let device = null;
```
and restore the comment on `const BUILD = '__BUILD__';` so it reads
`const BUILD = '__BUILD__';  // this page's code; see _display_build() in server.py`.

(b) In `scheduleRotate()`, replace
```js
  if (enabledScreens.length <= 1 || !AUTO_ROTATE) return;
  const raw = (enabledScreens[currentScreenIdx] || {}).duration || defaultDuration;
```
with
```js
  if (enabledScreens.length <= 1 || (device && !device.auto_rotate)) return;
  const raw = device ? device.seconds
    : ((enabledScreens[currentScreenIdx] || {}).duration || defaultDuration);
```

(c) In `poll()`, replace
```js
    const newFamily = themeData.active_family;
    const newVariant = themeData.active_variant;
```
with
```js
    // A device's own theme wins over the house theme, if it still exists.
    let newFamily = themeData.active_family, newVariant = themeData.active_variant;
    if (device && device.theme) {
      const [fam, variant] = device.theme.split('/');
      if (themeData.families[fam] && themeData.families[fam][variant]) {
        newFamily = fam; newVariant = variant;
      }
    }
```
and at the very start of `poll()`'s `try {` block add
`if (window.chiketiPollDevice) window.chiketiPollDevice();`.

(d) In the `resize` listener near the top, after `if (measureFrame() && …) renderDisplay();`
add `if (window.chiketiRegister && window.chiketiDevice) window.chiketiRegister();`.

(e) Replace the start block at the end:
```js
/* ── Start ── */
poll();
setInterval(poll, 2500);
```
with
```js
/* ── Start: pairing.js calls this once the display is approved ── */
window.chiketiApplyDevice = function (settings) {
  const before = device;
  device = settings;
  if (!before || before.theme !== settings.theme || before.auto_rotate !== settings.auto_rotate ||
      before.seconds !== settings.seconds) {
    scheduleRotate();
  }
};
window.chiketiStart = function (settings) {
  device = settings;
  poll();
  setInterval(poll, 2500);
};
if (window.CHIKETI_PENDING_START) window.chiketiStart(window.CHIKETI_PENDING_START);
```

- [ ] **Step 5: Run the unit tests and the harness**

Run: `.venv/bin/python -m pytest -q && node tests/js/render_harness.js && ./scripts/check_js.sh`
Expected: all pass (pairing.js is not part of `screen_functions.js`, so the harness is unaffected).

- [ ] **Step 6: Write the real-browser check `scripts/devices_check.mjs`**

```js
#!/usr/bin/env node
/* Real-browser check of pairing and the device-scoped control panel.
 *   python -m chiketi --no-kiosk --bind 127.0.0.1 --token secret &
 *   CHROME=/path/to/chrome NODE_PATH=... node scripts/devices_check.mjs
 * Uses the live server's API to approve/forget; it does not touch state on
 * any other machine. Exits 1 on the first failed expectation. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const BASE = process.env.CHIKETI_URL || 'http://127.0.0.1:7777';
const TOKEN = process.env.CHIKETI_TOKEN || 'secret';
const fail = (m) => { console.error('FAIL ' + m); process.exit(1); };
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json',
    'X-Chiketi-Token': TOKEN, Origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const id = 'check-' + Date.now().toString(36);
const browser = await chromium.launch({ executablePath: process.env.CHROME });

// 1. A new display shows a pairing code and no dashboard.
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1200 }, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`${BASE}/display?device=${id}`);
await page.waitForSelector('#pairing:not([hidden])');
const text = await page.textContent('#pairing');
if (!/NEW DISPLAY/.test(text) || !/[2-9A-Z]{2}-[2-9A-Z]{2}/.test(text)) fail('pairing page: ' + text);
if (!/touch/.test(text) || !/landscape/.test(text)) fail('caps not shown: ' + text);
console.log('ok   pairing page');

// 2. Approve -> dashboard within one poll; starting settings from touch.
const s = await api('POST', `/api/devices/${id}/approve`, { name: 'Check' });
if (s.auto_rotate !== false || s.gear !== true) fail('starting settings ' + JSON.stringify(s));
await page.waitForSelector('#display .screen-frame', { timeout: 8000 });
if (!(await page.isHidden('#pairing'))) fail('pairing still visible after approve');
console.log('ok   approve shows dashboard');

// 3. Per-device theme reaches the display.
await api('POST', `/api/devices/${id}`, { theme: 'Others/Claude' });
await page.waitForFunction(() => activeFamily === 'Others', null, { timeout: 8000 });
console.log('ok   device theme applied');

// 4. Forget -> back to pairing.
await api('POST', `/api/devices/${id}/forget`, {});
await page.waitForSelector('#pairing:not([hidden])', { timeout: 10000 });
console.log('ok   forget returns to pairing');

// 5. Strip shape and a hostile user agent: code fits, UA escaped.
const strip = await browser.newContext({ viewport: { width: 1920, height: 462 },
  userAgent: 'Mozilla/5.0 <img src=x onerror=alert(1)> Chrome/155.0' });
const sp = await strip.newPage();
await sp.goto(`${BASE}/display?device=${id}-s&feed=picture`);
await sp.waitForSelector('#pairing:not([hidden])');
if (await sp.$('#pairing img')) fail('user agent reached the page unescaped');
const over = await sp.evaluate(() => [...document.querySelectorAll('#pairing *')]
  .some(el => { const r = el.getBoundingClientRect(); return r.bottom > innerHeight + 1 || r.right > innerWidth + 1; }));
if (over) fail('pairing page overflows the strip');
console.log('ok   strip pairing page');

// 6. Too-old browser: message, no registration.
const old = await browser.newContext({ viewport: { width: 1024, height: 600 } });
await old.addInitScript(() => { CSS.supports = () => false; });
const op = await old.newPage();
await op.goto(`${BASE}/display?device=${id}-old`);
await op.waitForSelector('#pairing:not([hidden])');
if (!/too old/.test(await op.textContent('#pairing'))) fail('too-old message missing');
const listing = await api('GET', '/api/devices');
if (listing.pending.some(p => p.id === `${id}-old`)) fail('too-old browser registered');
console.log('ok   too-old browser');

// 7. Server forgets a pending request (restart) -> display registers again.
await api('POST', `/api/devices/${id}-s/reject`, {});
await sp.waitForFunction(() => /NEW DISPLAY/.test(document.getElementById('pairing').textContent), null, { timeout: 10000 });
const again = await api('GET', '/api/devices');
if (!again.pending.some(p => p.id === `${id}-s`)) fail('display did not register again');
console.log('ok   re-registers after losing its request');
await api('POST', `/api/devices/${id}-s/reject`, {});
await browser.close();
console.log('devices check OK');
```

- [ ] **Step 7: Run it**

```bash
cd ~/projects/chiketi
(setsid .venv/bin/python -m chiketi --no-kiosk --bind 127.0.0.1 --token secret >/tmp/chk.log 2>&1 &)
until curl -s -m1 127.0.0.1:7777/api/health >/dev/null; do sleep 1; done
CHROME=$(ls ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | head -1) \
  NODE_PATH=/home/user/projects/kiosk-deploy/tools/jetkvm/node_modules node scripts/devices_check.mjs
```
Expected: seven `ok` lines and `devices check OK`. Then stop that server (kill the python
process only; `pkill -f` would match your own shell). Note: the local server writes
`~/.config/chiketi/state.json` on devbox; that's a dev-only file.

- [ ] **Step 8: Commit**

```bash
git add chiketi/assets/ui/pairing.js chiketi/assets/ui/display.html chiketi/assets/ui/display_app.js \
        chiketi/server.py tests/test_server.py scripts/devices_check.mjs
git commit -m "feat(display): pairing page, device registration and per-device theme and rotation"
```

---

### Task 5: The control panel becomes the hub

**Files:**
- Modify: `chiketi/assets/ui/control.html`, `chiketi/assets/ui/control_app.js`,
  `chiketi/assets/ui/control.css`
- Test: extend `scripts/devices_check.mjs`

**Interfaces:**
- Consumes: `GET /api/devices`, `POST /api/devices/<id>[/approve|/reject|/forget]` (Task 3).
- Produces: `selectedDevice` (`''` = house defaults), `renderDeviceBar()`, `loadDevices()`.

- [ ] **Step 1: Markup** — in `control.html`, directly after `<p class="subtitle">…</p>`:
```html
<div class="device-bar">
  <label for="deviceSelect">Display</label>
  <select id="deviceSelect" class="category-select"></select>
  <span id="deviceInfo" class="device-info"></span>
  <button id="renameDevice" class="setting-btn" hidden>Rename</button>
  <button id="forgetDevice" class="setting-btn" hidden>Forget</button>
</div>
<div id="pendingList" class="pending-list"></div>
<div id="deviceSettings" class="settings-section" hidden>
  <h3>This display</h3>
  <label class="setting-row"><input type="checkbox" id="devAutoRotate"> Auto-rotate</label>
  <label class="setting-row">Seconds per screen
    <input type="number" id="devSeconds" min="3" max="600" step="5" style="width:72px"></label>
  <label class="setting-row"><input type="checkbox" id="devGear"> Settings tab on the display</label>
  <button id="devSave" class="setting-btn">Save display</button>
  <span id="devStatus" class="device-info"></span>
</div>
```
and add to `control.css`:
```css
.device-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0}
.device-info{color:#9aa0a6;font-size:12px}
.pending-list{display:flex;flex-direction:column;gap:8px;margin:6px 0}
.pending-card{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid #ffaa00;
  border-radius:6px;padding:8px 12px;color:#ccc}
.pending-card .code{font-size:22px;font-weight:700;letter-spacing:.12em;color:#ffaa00}
```

- [ ] **Step 2: Logic** — in `control_app.js`, after `let selectedFamily = null, selectedVariant = null;`:
```js
/* The display this panel is editing: '' = the house defaults (server-wide). */
let selectedDevice = '';
let devices = { devices: [], pending: [], now: 0 };

function ago(t, now) {
  if (!t) return 'never seen';
  const s = Math.max(0, Math.round(now - t));
  if (s > 120) return 'offline';
  return s + ' s ago';
}
function currentDevice() {
  return devices.devices.find(d => d.id === selectedDevice) || null;
}
async function loadDevices() {
  try {
    devices = await (await fetch(API + '/api/devices')).json();
  } catch (e) { return; }
  if (selectedDevice && !currentDevice()) selectedDevice = '';
  renderDeviceBar();
}
function renderDeviceBar() {
  const sel = document.getElementById('deviceSelect');
  const opts = [['', 'House defaults (all displays)']].concat(
    devices.devices.map(d => [d.id, d.name + ' · ' + ago(d.last_seen, devices.now)]));
  sel.innerHTML = opts.map(([v, t]) =>
    `<option value="${esc(v)}"${v === selectedDevice ? ' selected' : ''}>${esc(t)}</option>`).join('');
  sel.onchange = () => { selectedDevice = sel.value; applyDeviceScope(); };
  const d = currentDevice();
  const caps = d ? d.caps || {} : {};
  document.getElementById('deviceInfo').textContent = d
    ? `${d.id} · ${caps.w || '?'}×${caps.h || '?'} · ${caps.touch ? 'touch' : 'no touch'} · ${d.addr || ''}`
    : 'Theme and rotation for displays that have no setting of their own';
  document.getElementById('renameDevice').hidden = !d;
  document.getElementById('forgetDevice').hidden = !d;
  const pend = document.getElementById('pendingList');
  pend.innerHTML = devices.pending.map(p => {
    const c = p.caps || {};
    return `<div class="pending-card" data-id="${esc(p.id)}">` +
      `<span class="code">${esc(p.code.slice(0, 2) + '-' + p.code.slice(2))}</span>` +
      `<span>New display · ${esc(p.addr)} · ${c.w || '?'}×${c.h || '?'} · ` +
      `${c.touch ? 'touch' : 'no touch'} · ${esc(c.browser || '')}</span>` +
      `<button class="setting-btn" data-act="approve">Approve</button>` +
      `<button class="setting-btn" data-act="reject">Reject</button></div>`;
  }).join('');
  pend.querySelectorAll('button').forEach(b => {
    b.onclick = async () => {
      const id = b.closest('.pending-card').dataset.id;
      if (b.dataset.act === 'approve') {
        const name = prompt('Name this display (code on screen must match):');
        if (!name) return;
        await post(`/api/devices/${id}/approve`, { name });
        selectedDevice = id;
      } else {
        await post(`/api/devices/${id}/reject`, {});
      }
      await loadDevices();
      applyDeviceScope();
    };
  });
}
/* Point the theme picker, preview shape and display settings at the selection. */
function applyDeviceScope() {
  const d = currentDevice();
  const box = document.getElementById('deviceSettings');
  box.hidden = !d;
  if (d) {
    document.getElementById('devAutoRotate').checked = d.auto_rotate;
    document.getElementById('devSeconds').value = d.seconds;
    document.getElementById('devGear').checked = d.gear;
    const [fam, variant] = (d.theme || '').split('/');
    if (d.theme && currentData.families[fam]) { selectedFamily = fam; selectedVariant = variant; }
    else { selectedFamily = currentData.active_family; selectedVariant = currentData.active_variant; }
    if (d.caps && d.caps.w && d.caps.h) updatePreviewAspectRatio(d.caps.w, d.caps.h);
  } else if (currentData) {
    selectedFamily = currentData.active_family; selectedVariant = currentData.active_variant;
    loadSettings();
  }
  renderDeviceBar();
  renderCategoryDropdown(); renderVariantRow(); renderScreens(); renderScreenRotationUI();
}
```

- [ ] **Step 3: Route theme clicks through the selection** — replace `selectTheme`:
```js
async function selectTheme(family, variant) {
  try {
    const res = selectedDevice
      ? await post(`/api/devices/${selectedDevice}`, { theme: family + '/' + variant })
      : await post('/api/theme/' + family + '/' + variant);
    if (res.ok) {
      if (selectedDevice) await loadDevices(); else await loadThemes();
      setStatus((selectedDevice ? currentDevice().name : 'House') + ' theme: ' + family + '/' + variant, true);
    }
  } catch(e) { setStatus('Failed to set theme', false); }
}
```
In `renderVariantRow`, mark "(live)" against the selected device's theme when one is selected:
replace `const isActive = selectedFamily === currentData.active_family;` and the `live` line with
```js
  const d = currentDevice();
  const liveKey = d && d.theme ? d.theme : currentData.active_family + '/' + currentData.active_variant;
```
```js
    const live = liveKey === selectedFamily + '/' + name;
```
Add, after the variant buttons loop, a "House theme" button shown only for a device:
```js
  if (currentDevice()) {
    const hb = document.createElement('button');
    hb.className = 'variant-btn' + (currentDevice().theme ? '' : ' active');
    hb.textContent = 'House theme';
    hb.onclick = async () => {
      await post(`/api/devices/${selectedDevice}`, { theme: '' });
      await loadDevices(); applyDeviceScope();
    };
    el.appendChild(hb);
  }
```

- [ ] **Step 4: Buttons, labels and polling** — append:
```js
document.getElementById('devSave').addEventListener('click', async () => {
  const body = {
    auto_rotate: document.getElementById('devAutoRotate').checked,
    seconds: parseInt(document.getElementById('devSeconds').value, 10) || 30,
    gear: document.getElementById('devGear').checked,
  };
  const res = await post(`/api/devices/${selectedDevice}`, body);
  document.getElementById('devStatus').textContent = res.ok ? 'Saved' : 'Failed to save';
  await loadDevices();
});
document.getElementById('renameDevice').addEventListener('click', async () => {
  const d = currentDevice(); if (!d) return;
  const name = prompt('New name for ' + d.name + ':', d.name);
  if (!name) return;
  await post(`/api/devices/${d.id}`, { name });
  await loadDevices();
});
document.getElementById('forgetDevice').addEventListener('click', async () => {
  const d = currentDevice(); if (!d) return;
  if (!confirm(`Forget ${d.name}? It will show a new pairing code.`)) return;
  await post(`/api/devices/${d.id}/forget`, {});
  selectedDevice = '';
  await loadDevices(); applyDeviceScope();
});
loadDevices();
setInterval(loadDevices, 3000);
```
In `renderScreenRotationUI()`, before the loop, add a heading line so it is clear the list is
house-wide when a device is selected:
```js
  if (selectedDevice) {
    const note = document.createElement('div');
    note.style.cssText = 'color:#9aa0a6;font-size:12px';
    note.textContent = 'Screens: all displays';
    el.appendChild(note);
  }
```

- [ ] **Step 5: Extend `scripts/devices_check.mjs`** — before `await browser.close();` add:
```js
// 8. Control panel: a pending display appears; approving it scopes the panel.
const pid = id + '-p';
const dpage = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
await dpage.goto(`${BASE}/display?device=${pid}`);
await dpage.waitForSelector('#pairing:not([hidden])');
const panel = await (await browser.newContext()).newPage();
panel.on('dialog', d => d.accept('Panel Check'));
await panel.goto(`${BASE}/#token=${TOKEN}`);
await panel.waitForSelector(`.pending-card[data-id="${pid}"]`, { timeout: 8000 });
await panel.click(`.pending-card[data-id="${pid}"] button[data-act="approve"]`);
await panel.waitForFunction(i => document.getElementById('deviceSelect').value === i, pid);
if (await panel.isHidden('#deviceSettings')) fail('device settings not shown for a device');
await panel.click('#variantRow button:has-text("TNG")');
await panel.waitForTimeout(500);
const after = await api('GET', '/api/devices');
const dev = after.devices.find(d => d.id === pid);
if (!dev || dev.theme !== 'Sci-Fi/TNG') fail('theme click did not reach the device: ' + JSON.stringify(dev));
const themes = await (await fetch(BASE + '/api/themes')).json();
if (themes.active_variant === 'TNG') fail('device theme changed the house theme');
await panel.selectOption('#deviceSelect', '');
if (!(await panel.isHidden('#deviceSettings'))) fail('house scope still shows device settings');
console.log('ok   control panel hub');
await api('POST', `/api/devices/${pid}/forget`, {});
```
Note `#variantRow` holds the current family's variants, so make sure the selected family is
Sci-Fi first if the house theme isn't (`await panel.selectOption('#categorySelect', 'Sci-Fi')`
before the click).

- [ ] **Step 6: Run everything**

Run the server as in Task 4 Step 7, then
`node scripts/devices_check.mjs`, `node tests/js/render_harness.js`, `./scripts/check_js.sh`,
`.venv/bin/python -m pytest -q`.
Expected: eight `ok` lines and `devices check OK`; everything else passes.

- [ ] **Step 7: Commit**

```bash
git add chiketi/assets/ui/control.html chiketi/assets/ui/control_app.js chiketi/assets/ui/control.css scripts/devices_check.mjs
git commit -m "feat(control): the control panel is the hub -- display drop-down, pairing approvals, per-display settings"
```

---

### Task 6: Rollout to chiketi-server, the Go and the wide LCD

**Files (kiosk-deploy, not a git repo):**
- Modify: `kiosk-1/shell.html`, `chiketi-server/lcd-snap/lcd_snap.py`, `CLAUDE.md`

- [ ] **Step 1: Point the kiosks at their device ids**

`kiosk-1/shell.html`: replace both `display?rotate=off` with `display?device=kiosk-1`.
`chiketi-server/lcd-snap/lcd_snap.py`: change the default URL to
`'http://127.0.0.1:7777/display?device=wide-1&feed=picture'`.

- [ ] **Step 2: Deploy chiketi, then the two kiosks**

```bash
cd /home/user/projects/kiosk-deploy/chiketi-server && ./deploy.sh
ssh user@192.0.2.202 'cp -p ~/kiosk/shell.html ~/kiosk/shell.html.bak-$(date +%Y%m%d)b'
scp ../kiosk-1/shell.html user@192.0.2.202:kiosk/shell.html
ssh user@192.0.2.202 'sudo systemctl restart kiosk'
scp lcd-snap/lcd_snap.py user@192.0.2.203:/tmp/
ssh user@192.0.2.203 'sudo cp -p /opt/lcd-snap/lcd_snap.py /opt/lcd-snap/lcd_snap.py.bak-$(date +%Y%m%d)
  sudo install -m644 /tmp/lcd_snap.py /opt/lcd-snap/lcd_snap.py && sudo systemctl restart lcd-snap'
```
Expected: both screens show a pairing code. On the LCD, the Lcdhost program shows the pairing
picture (it's a fresh frame), so the owner sees the code there too.

- [ ] **Step 3: the owner approves them**

Ask the owner to open the control panel (`http://192.0.2.203:7777/#token=…`) and approve the two
codes as "Surface Go" and "9.3in wide LCD". Verify afterwards:
```bash
curl -s http://192.0.2.203:7777/api/devices | python3 -m json.tool
```
Expected: `kiosk-1` with `auto_rotate: false, gear: true`; `wide-1` with
`auto_rotate: true, seconds: 30, gear: false`; nothing pending.

- [ ] **Step 4: Update `CLAUDE.md`** — replace the "Display rotation:" bullet with the device
model: ids, pairing, where settings live (`state.json` `devices` on chiketi-server), how to re-pair
(Forget in the panel), and that `?rotate=off` is gone.
