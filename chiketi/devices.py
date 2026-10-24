"""Displays registered with this chiketi: pairing, capabilities, per-device settings.

A display that chiketi has not approved is *pending*: it shows a pairing code
until someone approves it in the control panel. Approved devices are saved in
state.json; pending requests live only in memory (they are cheap to recreate:
a display whose request was lost just registers again and gets a new code).

Pairing keeps the device list tidy and intentional. It is not access control:
/display and /api/metrics stay readable on the LAN, as before.
"""

from __future__ import annotations

import math
import re
import secrets
import threading
import time

from chiketi import screens as SCREENS
from chiketi.config import TIMING
from chiketi.themes import THEMES

ID_RE = re.compile(r"^[a-z0-9-]{1,32}$")
# chiketi's own screen: approved at start-up, no pairing (see ensure_local).
LOCAL_ID = "local"
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
    # fullmatch: `$` alone would let a trailing newline through.
    return isinstance(x, str) and bool(ID_RE.fullmatch(x))


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


def starting_settings(caps: dict, kiosk: bool = False) -> dict:
    """A new display's settings. Kiosk when the house has Kiosk data, else Self;
    --rotate-interval gives the starting seconds."""
    touch = bool(caps.get("touch")) and caps.get("feed") != "picture"
    mode = "kiosk" if kiosk else "self"
    seconds = max(SECONDS_MIN, min(SECONDS_MAX, int(TIMING.rotate_interval_s)))
    return {"auto_rotate": not touch, "seconds": seconds, "theme": "", "gear": touch,
            "mode": mode, "screens": SCREENS.defaults(mode)}


def _apply(rec: dict, body: dict, fields: tuple) -> bool:
    """Validate the WHOLE body first, then change rec. Raises ValueError.
    Returns whether anything actually changed (callers skip the disk write)."""
    new = {}
    if "auto_rotate" in fields and "auto_rotate" in body:
        if not isinstance(body["auto_rotate"], bool):
            raise ValueError("auto_rotate must be true or false")
        new["auto_rotate"] = body["auto_rotate"]
    if "seconds" in fields and "seconds" in body:
        n = body["seconds"]
        if isinstance(n, bool) or not isinstance(n, (int, float)):
            raise ValueError("seconds must be a number")
        if isinstance(n, float):
            if not math.isfinite(n):
                raise ValueError("seconds must be a number")
            n = int(n)
        new["seconds"] = max(SECONDS_MIN, min(SECONDS_MAX, n))   # ints of any size clamp
    if "gear" in fields and "gear" in body:
        if not isinstance(body["gear"], bool):
            raise ValueError("gear must be true or false")
        new["gear"] = body["gear"]
    if "name" in fields and "name" in body:
        name = _text(body["name"], _NAME_MAX)
        if not name:
            raise ValueError("name must not be empty")
        new["name"] = name
    # The mode first: screens and a theme are checked against the RESULTING mode.
    # Self-service has no "mode" in its fields, so it is always the stored one.
    mode = rec.get("mode") or "self"
    if "mode" in fields and "mode" in body:
        if body["mode"] not in SCREENS.MODES:
            raise ValueError("unknown mode")
        if body["mode"] != mode:
            new["mode"] = mode = body["mode"]
            new["screens"] = SCREENS.defaults(mode)
            if rec.get("theme") and not SCREENS.theme_allowed(mode, rec["theme"]):
                new["theme"] = ""
    if "screens" in fields and "screens" in body:
        raw = body["screens"]
        if not isinstance(raw, list) or len(raw) > SCREENS.MAX_SCREENS:
            raise ValueError(f"screens must be a list of at most {SCREENS.MAX_SCREENS}")
        if SCREENS.clean_screens(mode, raw) != raw:
            raise ValueError(f"screens must be unique {mode} screens")
        new["screens"] = list(raw)
    if "theme" in fields and "theme" in body:
        th = body["theme"]
        if not isinstance(th, str) or (th != "" and th not in THEMES):
            raise ValueError("unknown theme")
        if th and not SCREENS.theme_allowed(mode, th):
            raise ValueError(f"{th} is not a {mode} theme")
        new["theme"] = th
    changed = any(rec.get(k) != v for k, v in new.items())
    rec.update(new)
    return changed


def _clean_record(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    rec = {"name": _text(raw.get("name"), _NAME_MAX) or "Display",
           **starting_settings({}), "caps": clean_caps(raw.get("caps"))}
    for key, ok in (("auto_rotate", lambda v: isinstance(v, bool)),
                    ("gear", lambda v: isinstance(v, bool)),
                    ("theme", lambda v: isinstance(v, str) and (v == "" or v in THEMES))):
        if key in raw and ok(raw[key]):
            rec[key] = raw[key]
    secs = _int(raw.get("seconds"), SECONDS_MIN, SECONDS_MAX)
    if secs is not None:
        rec["seconds"] = secs
    # A record from before modes has no mode: None tells DeviceRegistry.load to
    # settle it, which only it can do (it knows whether the house has Kiosk data).
    mode = raw.get("mode") if raw.get("mode") in SCREENS.MODES else None
    rec["mode"] = mode
    rec["screens"] = SCREENS.clean_screens(mode, raw.get("screens")) if mode else None
    if mode and rec["theme"] and not SCREENS.theme_allowed(mode, rec["theme"]):
        rec["theme"] = ""
    return rec


def clean_devices(raw) -> dict:
    """Saved devices from state.json: bad entries dropped, at most MAX_DEVICES."""
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    for dev_id, rec in raw.items():
        # The local screen does not count against the cap, so it is never the one dropped.
        if dev_id != LOCAL_ID and sum(k != LOCAL_ID for k in out) >= MAX_DEVICES:
            continue
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
        # Whether this house has Kiosk data (screens.kiosk_capable()), set at
        # start-up before load(): new and migrated displays start in Kiosk if so.
        self.kiosk_capable = False

    def _settle(self, rec: dict) -> None:
        """Fill in a saved device's missing mode/screens (records from before modes)."""
        if rec.get("mode") not in SCREENS.MODES:
            rec["mode"] = "kiosk" if self.kiosk_capable else "self"
            rec["screens"] = None
        if rec.get("screens") is None:
            rec["screens"] = SCREENS.defaults(rec["mode"])
        if rec.get("theme") and not SCREENS.theme_allowed(rec["mode"], rec["theme"]):
            rec["theme"] = ""

    def load(self, devices) -> None:
        with self._lock:
            self._devices = clean_devices(devices)
            for rec in self._devices.values():
                self._settle(rec)

    def snapshot(self) -> dict:
        with self._lock:
            return {k: {**v, "caps": dict(v["caps"]), "screens": list(v["screens"])}
                    for k, v in self._devices.items()}

    def _public(self, dev_id: str) -> dict:
        d = self._devices[dev_id]
        return {"id": dev_id, "name": d["name"], "auto_rotate": d["auto_rotate"],
                "seconds": d["seconds"], "theme": d["theme"], "gear": d["gear"],
                "mode": d["mode"], "screens": list(d["screens"])}

    def _expire(self, now: float) -> None:
        for dev_id in [k for k, p in self._pending.items() if now - p["last_seen"] > PENDING_TTL]:
            del self._pending[dev_id]
            self._seen.pop(dev_id, None)

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
            self._expire(now)            # before recording: expiry drops sightings
            self._seen[dev_id] = (now, addr)
            if dev_id in self._devices:
                changed = self._devices[dev_id]["caps"] != caps
                self._devices[dev_id]["caps"] = dict(caps)
                return {"status": "approved", "settings": self._public(dev_id)}, changed
            p = self._pending.get(dev_id)
            if p is None:
                if len(self._pending) >= MAX_PENDING:
                    oldest = min(self._pending, key=lambda k: self._pending[k]["last_seen"])
                    del self._pending[oldest]
                    self._seen.pop(oldest, None)
                p = self._pending[dev_id] = {"code": self._new_code(), "first_seen": now}
            p.update(caps=dict(caps), addr=addr, last_seen=now)
            return {"status": "pending", "code": p["code"]}, False

    def status(self, dev_id: str, addr: str) -> dict:
        """A display's poll. Unknown means 'register again'."""
        now = self._clock()
        with self._lock:
            if dev_id in self._devices:
                self._seen[dev_id] = (now, addr)
                return {"status": "approved", "settings": self._public(dev_id)}
            self._expire(now)
            p = self._pending.get(dev_id)
            if p is None:
                return {"status": "unknown"}     # not remembered: any id can ask
            self._seen[dev_id] = (now, addr)
            p["last_seen"], p["addr"] = now, addr
            return {"status": "pending", "code": p["code"]}

    def self_update(self, dev_id: str, body: dict, with_changed: bool = False):
        with self._lock:
            changed = _apply(self._devices[dev_id], body, ("auto_rotate", "seconds", "theme"))
            out = self._public(dev_id)
            return (out, changed) if with_changed else out

    def admin_update(self, dev_id: str, body: dict, with_changed: bool = False):
        with self._lock:
            changed = _apply(self._devices[dev_id], body,
                             ("auto_rotate", "seconds", "theme", "gear", "name", "mode", "screens"))
            out = self._public(dev_id)
            return (out, changed) if with_changed else out

    def approve(self, dev_id: str, name: str) -> dict:
        with self._lock:
            p = self._pending[dev_id]
            if sum(k != LOCAL_ID for k in self._devices) >= MAX_DEVICES:
                raise ValueError(f"at most {MAX_DEVICES} devices")
            rec = {"name": "Display", **starting_settings(p["caps"], self.kiosk_capable),
                   "caps": dict(p["caps"])}
            _apply(rec, {"name": name}, ("name",))
            self._devices[dev_id] = rec
            del self._pending[dev_id]
            return self._public(dev_id)

    def ensure_local(self, name: str) -> bool:
        """chiketi's own screen: approved, Self mode, no pairing. Keeps its settings.
        Returns True if it was created (the caller saves)."""
        with self._lock:
            if LOCAL_ID in self._devices:
                return False
            rec = {"name": "Display", **starting_settings({}), "caps": {}}
            rec.update(auto_rotate=True, gear=False)
            _apply(rec, {"name": name or "This screen"}, ("name",))
            self._devices[LOCAL_ID] = rec
            return True

    def reject(self, dev_id: str) -> None:
        with self._lock:
            del self._pending[dev_id]
            self._seen.pop(dev_id, None)

    def forget(self, dev_id: str) -> None:
        with self._lock:
            del self._devices[dev_id]
            self._seen.pop(dev_id, None)

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
