# Screen Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each display gets a mode (Kiosk or Self) and its own ordered list of screens. One description of the screens drives the display, the control panel, the harness and the site, and every coloured tab leads to a screen.

**Architecture:**
- `chiketi/assets/ui/screens.json` holds the screen sets.
- `chiketi/screens.py` reads it so the server can validate settings, and the server inlines it into both pages as `SCREEN_SPEC`.
- In JavaScript, `screenRenderer()` and `screenPlan()` (in `screen_functions.js`) replace the four copies of the registry. The tab bar is drawn from the plan.
- Device records gain `mode` and `screens`. The house-wide `screen_rotation` is removed, and `kiosk_theme` is added.

**Tech Stack:** Python 3.11+ (stdlib HTTP server, pytest); browser JavaScript inlined into HTML (the pairing page is ES5); Node for the harness; Playwright-core with headless Chromium for the browser checks.

**Spec:** `specs/2026-10-23-screen-modes-design.md`

## Global Constraints

- The repo is public. Use only documentation addresses (`192.0.2.x`) in tests and docs.
- Modes: `kiosk` (themes `Sci-Fi/TOS`, `Others/Claude`, default theme `Sci-Fi/TOS`, screens `overview, myday, home, lab, sessions, harness, gpus`, defaults `lab, sessions`) and `self` (themes `all`, default theme `Sci-Fi/TOS`, screens `screen1..screen5`, defaults all five).
- Only `lab` and `sessions` are built in Kiosk.
- `screens` lists hold at most 16 entries, unique, all from the device's mode. An empty list is allowed.
- `mode` and `screens` are admin-only: they go through `/api/devices/<id>` (token) and never through `/api/device/<id>`.
- Any actual mode change clears a *stored* theme the new mode does not allow. A *supplied* unsupported theme rejects the request.
- Every invalid field rejects the whole request, and nothing changes.
- `local` is the device ID of chiketi's own screen. It is created only when chiketi launches its own kiosk.
- The display poll has an 8 s deadline. Polls never overlap, and a failed batch commits nothing.
- Harness rules: no layout `px` over 2 (use `gq()`); every metric string goes through `esc()`; the `FULL` fixture defines every metric key; no `undefined`/`NaN` in output.
- Don't run `ruff format`. Run `ruff check` on changed files and add no new findings.
- Restart the dev server after editing `assets/ui/*`. Use a throwaway `XDG_CONFIG_HOME`. Never `pkill -f`.
- Every commit ends with the two attribution lines:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01FoFFf4K4CUrdH6HPDArPdC`.

## Review Focus

1. A saved `state.json` from the deployed house (devices without `mode`, a `screen_rotation` with Home Lab off, house theme `Others/Claude`) must load as two Kiosk displays showing [Home Lab, Sessions]. → Task 3 `test_house_state_migrates`.
2. Tapping a tab on the touch Go while a poll redraw lands between pointer-down and pointer-up must still navigate. → Task 8, devices_check step 14.
3. A Kiosk display whose selected screens have no data (no `homelab.toml`) must show the notice with grey tabs, not a blank page or System Stats. → Task 4, harness `KIOSK_EMPTY`.
4. Switching a Self display on Terminal to Kiosk must land on TOS, never a Terminal-coloured Kiosk screen. → Task 2 `test_mode_switch_clears_unsupported_theme`, and Task 5's theme resolution in devices_check step 13.
5. The 1920×462 LCD with 7 ticked tabs must not overflow its side column. → Task 4 strip tab-count loop, and Task 8 `fit_check` with `TABS=7`.

---

## File map

| File | Change |
|------|--------|
| `chiketi/assets/ui/screens.json` | new: the screen sets |
| `chiketi/screens.py` | new: loads `screens.json`; `theme_allowed`, `defaults`, `clean_screens`, `kiosk_capable` |
| `chiketi/devices.py` | `mode`/`screens` fields, validation, starting mode, `ensure_local`, migration on load |
| `chiketi/state.py` | drop `screen_rotation`, add `kiosk_theme`, back up before migrating |
| `chiketi/server.py` | drop `screen_rotation`; `_kiosk_theme`; `/api/kiosk-theme/…`; `SCREEN_SPEC` inlined; build id includes `screens.json` |
| `chiketi/app.py`, `chiketi/config.py`, `chiketi/__main__.py` | `?device=local`, `ensure_local`, kiosk capability, `--rotate-interval` = starting seconds (default 30) |
| `chiketi/assets/ui/screen_functions.js` | `screenRenderer`, `screenPlan`, `themeAllowed`, `screenReady`, `setTabPlan`, plan-driven tabs, column shrink, Overview/GPUs icons, Kiosk notice; TNG/DS9 Kiosk wrappers removed |
| `chiketi/assets/ui/display_app.js` | one render state, poll guard and deadline, navigation by ID, tap ID taken at pointer-down |
| `chiketi/assets/ui/pairing.js` | sequence numbers on every settings reply |
| `chiketi/assets/ui/control_app.js`, `control.html`, `control.css` | mode, screens list, warnings, per-mode theme picker, house mode toggle; rotation UI removed |
| `tests/js/render_harness.js` | registry from the spec; plan, tab and notice tests |
| `scripts/gen_site_assets.py`, `docs/site/*` | site uses `screenRenderer`; regenerated |
| `scripts/fit_check.mjs`, `scripts/devices_check.mjs` | stub pairing; new steps |
| `tests/test_screens.py` (new), `tests/test_devices.py`, `tests/test_server_devices.py`, `tests/test_server.py`, `tests/test_state.py`, `tests/test_app.py`, `tests/conftest.py` | tests |
| `CLAUDE.md`, `README.md`, `CHANGELOG.md` | docs |

---

### Task 1: The screen sets (`screens.json`, `chiketi/screens.py`)

**Files:**
- Create: `chiketi/assets/ui/screens.json`, `chiketi/screens.py`, `tests/test_screens.py`

**Interfaces:**
- Produces:
  - `SPEC: dict` (the parsed file)
  - `MODES: tuple[str, ...]` = `("kiosk", "self")`
  - `theme_allowed(mode: str, key: str) -> bool`
  - `mode_screens(mode) -> list[str]`
  - `defaults(mode) -> list[str]` (a fresh copy)
  - `default_theme(mode) -> str`
  - `clean_screens(mode, raw) -> list[str] | None` (None when `raw` is not a list)
  - `kiosk_capable() -> bool`
  - `MAX_SCREENS = 16`

- [ ] **Step 1: Write the failing tests** (`tests/test_screens.py`)

```python
"""screens.json: the screen sets each display mode offers."""
from __future__ import annotations

import re

from chiketi import screens
from chiketi.themes import THEMES


def test_modes_and_ids():
    assert screens.MODES == ("kiosk", "self")
    kiosk, self_ = screens.mode_screens("kiosk"), screens.mode_screens("self")
    assert kiosk == ["overview", "myday", "home", "lab", "sessions", "harness", "gpus"]
    assert self_ == ["screen1", "screen2", "screen3", "screen4", "screen5"]
    assert not set(kiosk) & set(self_)
    assert len(set(kiosk)) == len(kiosk) and len(set(self_)) == len(self_)
    assert set(screens.SPEC["screens"]) == set(kiosk) | set(self_)


def test_fields():
    for sid in screens.mode_screens("kiosk"):
        s = screens.SPEC["screens"][sid]
        assert s["name"] and s["label"] and isinstance(s["built"], bool)
        assert re.fullmatch(r"#[0-9A-Fa-f]{6}|[A-Za-z][A-Za-z0-9]*", s["color"]), sid
        assert s["needs"] in (None, "sessions", "homelab")
    for sid in screens.mode_screens("self"):
        assert screens.SPEC["screens"][sid]["name"] and screens.SPEC["screens"][sid]["built"] is True
    assert [s for s in screens.mode_screens("kiosk") if screens.SPEC["screens"][s]["built"]] == ["lab", "sessions"]


def test_defaults_and_themes():
    for mode in screens.MODES:
        assert set(screens.defaults(mode)) <= set(screens.mode_screens(mode))
        assert screens.default_theme(mode) in THEMES
        assert screens.theme_allowed(mode, screens.default_theme(mode))
    assert screens.defaults("kiosk") == ["lab", "sessions"]
    d = screens.defaults("kiosk"); d.append("x")
    assert screens.defaults("kiosk") == ["lab", "sessions"]          # a copy
    for key in screens.SPEC["modes"]["kiosk"]["themes"]:
        assert key in THEMES
    assert screens.theme_allowed("kiosk", "Others/Claude")
    assert not screens.theme_allowed("kiosk", "Terminal/hacker")
    assert screens.theme_allowed("self", "Terminal/hacker")
    assert not screens.theme_allowed("self", "Nope/x")
    assert not screens.theme_allowed("bogus", "Sci-Fi/TOS")


def test_clean_screens():
    assert screens.clean_screens("kiosk", ["sessions", "lab", "sessions", "screen1", 5, "zzz"]) == ["sessions", "lab"]
    assert screens.clean_screens("kiosk", []) == []
    assert screens.clean_screens("kiosk", "lab") is None
    assert screens.clean_screens("self", ["screen9", "screen2"]) == ["screen2"]
    assert len(screens.clean_screens("self", ["screen1"] * 40)) == 1


def test_kiosk_capable(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    d = tmp_path / "chiketi"; d.mkdir()
    assert screens.kiosk_capable() is False                         # nothing configured
    (d / "sessions.toml").write_text("")                            # empty: no url
    assert screens.kiosk_capable() is False
    (d / "sessions.toml").write_text("url = [")                     # malformed
    assert screens.kiosk_capable() is False
    (d / "homelab.toml").write_text("poll_seconds = 30\n")          # loads, but no hosts
    assert screens.kiosk_capable() is False
    (d / "sessions.toml").write_text('url = "http://192.0.2.10:7781/sessions"\n')
    assert screens.kiosk_capable() is True
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/bin/python -m pytest tests/test_screens.py -q`
Expected: ImportError, `cannot import name 'screens'`.

- [ ] **Step 3: Write `chiketi/assets/ui/screens.json`**

```json
{
  "modes": {
    "kiosk": {
      "name": "Kiosk",
      "themes": ["Sci-Fi/TOS", "Others/Claude"],
      "default_theme": "Sci-Fi/TOS",
      "screens": ["overview", "myday", "home", "lab", "sessions", "harness", "gpus"],
      "defaults": ["lab", "sessions"]
    },
    "self": {
      "name": "Self",
      "themes": "all",
      "default_theme": "Sci-Fi/TOS",
      "screens": ["screen1", "screen2", "screen3", "screen4", "screen5"],
      "defaults": ["screen1", "screen2", "screen3", "screen4", "screen5"]
    }
  },
  "screens": {
    "overview": {"name": "Overview", "label": "OVERVIEW", "built": false, "color": "label", "needs": null},
    "myday":    {"name": "My Day", "label": "MY DAY", "built": false, "color": "a3", "needs": null},
    "home":     {"name": "My Home", "label": "MY HOME", "built": false, "color": "a4", "needs": null},
    "lab":      {"name": "Home Lab", "label": "HOME LAB", "built": true, "color": "dRam", "needs": "homelab"},
    "sessions": {"name": "Sessions", "label": "SESSIONS", "built": true, "color": "#D97757", "needs": "sessions"},
    "harness":  {"name": "AI Harness", "label": "AI HARNESS", "built": false, "color": "a2", "needs": null},
    "gpus":     {"name": "GPUs", "label": "GPUS", "built": false, "color": "a1", "needs": null},
    "screen1":  {"name": "System Stats", "built": true},
    "screen2":  {"name": "NPU / AI", "built": true},
    "screen3":  {"name": "Claude Usage", "built": true},
    "screen4":  {"name": "GPU", "built": true},
    "screen5":  {"name": "Clock", "built": true}
  }
}
```

- [ ] **Step 4: Write `chiketi/screens.py`**

```python
"""The screen sets each display mode offers, from assets/ui/screens.json.

The same file is inlined into the display and control pages as SCREEN_SPEC, so
the server validates settings against exactly what the pages draw."""

from __future__ import annotations

import json
import os

from chiketi.themes import THEMES

_PATH = os.path.join(os.path.dirname(__file__), "assets", "ui", "screens.json")
with open(_PATH, encoding="utf-8") as _fh:
    SPEC: dict = json.load(_fh)

MODES: tuple[str, ...] = tuple(SPEC["modes"])
MAX_SCREENS = 16


def mode_screens(mode: str) -> list[str]:
    return list(SPEC["modes"][mode]["screens"])


def defaults(mode: str) -> list[str]:
    return list(SPEC["modes"][mode]["defaults"])


def default_theme(mode: str) -> str:
    return SPEC["modes"][mode]["default_theme"]


def theme_allowed(mode: str, key: str) -> bool:
    if mode not in SPEC["modes"] or key not in THEMES:
        return False
    allowed = SPEC["modes"][mode]["themes"]
    return allowed == "all" or key in allowed


def clean_screens(mode: str, raw) -> list[str] | None:
    """Valid, unique IDs of the mode in their given order; None if raw is not a list."""
    if not isinstance(raw, list):
        return None
    ok, out = SPEC["modes"][mode]["screens"], []
    for sid in raw:
        if isinstance(sid, str) and sid in ok and sid not in out:
            out.append(sid)
    return out[:MAX_SCREENS]


def kiosk_capable() -> bool:
    """Whether this house has Kiosk data: a sessions feed or a Home Lab with hosts
    whose config loads. Whether the feed is online does not matter."""
    from chiketi.collectors import sessions
    from chiketi.collectors.homelab import config as homelab
    if sessions._load(sessions.default_path()) is not None:
        return True
    try:
        return bool(homelab.load_config(homelab.default_path()).hosts)
    except (OSError, ValueError):
        return False
```

`ConfigError` is a `ValueError`, and `FileNotFoundError` is an `OSError`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `.venv/bin/python -m pytest tests/test_screens.py -q`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add chiketi/assets/ui/screens.json chiketi/screens.py tests/test_screens.py
git commit -m "feat(screens): screens.json -- the Kiosk and Self screen sets"
```

---

### Task 2: Device mode and screens (`devices.py`)

**Files:**
- Modify: `chiketi/devices.py`, `chiketi/config.py:9` (`rotate_interval_s: int = 30`)
- Test: `tests/test_devices.py`

**Interfaces:**
- Consumes: Task 1, `chiketi.screens`.
- Produces:
  - `starting_settings(caps, kiosk: bool = False) -> dict`, with keys `auto_rotate, seconds, theme, gear, mode, screens`;
  - `DeviceRegistry.kiosk_capable: bool` (attribute, default False);
  - `DeviceRegistry.ensure_local(name: str) -> bool` (True if it created the device);
  - `LOCAL_ID = "local"`;
  - `_public()` now includes `mode` and `screens`;
  - `clean_devices(raw)` keeps `mode: None` and `screens: None` when they are missing or bad, so the migration can tell them apart;
  - `DeviceRegistry.load()` fills them in.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_devices.py`; update `test_starting_settings`)

```python
def test_starting_settings():
    assert starting_settings(clean_caps(GO)) == {"auto_rotate": False, "seconds": 30, "theme": "", "gear": True,
                                                 "mode": "self", "screens": ["screen1", "screen2", "screen3", "screen4", "screen5"]}
    assert starting_settings(clean_caps(GO), kiosk=True)["mode"] == "kiosk"
    assert starting_settings(clean_caps(GO), kiosk=True)["screens"] == ["lab", "sessions"]
    assert starting_settings(clean_caps(LCD)) ["auto_rotate"] is True
    touch_picture = dict(GO, feed="picture")
    assert starting_settings(clean_caps(touch_picture))["auto_rotate"] is True


def approved(r, dev_id="kiosk-1", caps=GO):
    r.register(dev_id, clean_caps(caps), "192.0.2.202")
    return r.approve(dev_id, "Go")


def test_new_display_mode_follows_kiosk_capability():
    r, _ = reg()
    assert approved(r)["mode"] == "self"
    r2, _ = reg(); r2.kiosk_capable = True
    s = approved(r2)
    assert s["mode"] == "kiosk" and s["screens"] == ["lab", "sessions"]


def test_admin_sets_mode_and_screens():
    r, _ = reg(); r.kiosk_capable = True
    approved(r)
    out = r.admin_update("kiosk-1", {"screens": ["sessions", "overview", "lab"]})
    assert out["screens"] == ["sessions", "overview", "lab"]
    out = r.admin_update("kiosk-1", {"mode": "self"})
    assert out["mode"] == "self" and out["screens"] == ["screen1", "screen2", "screen3", "screen4", "screen5"]
    out = r.admin_update("kiosk-1", {"mode": "kiosk", "screens": []})
    assert out["mode"] == "kiosk" and out["screens"] == []


@pytest.mark.parametrize("body", [
    {"mode": "tv"}, {"mode": 1}, {"screens": "lab"}, {"screens": ["lab", "lab"]},
    {"screens": ["screen1"]}, {"screens": ["zzz"]}, {"screens": [None]},
    {"mode": "self", "screens": ["lab"]},
])
def test_bad_mode_or_screens_rejected_and_nothing_changes(body):
    r, _ = reg(); r.kiosk_capable = True
    approved(r)
    before = r.snapshot()
    with pytest.raises(ValueError):
        r.admin_update("kiosk-1", dict(body, seconds=99))
    assert r.snapshot() == before


def test_too_many_screens_rejected():
    r, _ = reg(); r.kiosk_capable = True
    approved(r)
    with pytest.raises(ValueError):
        r.admin_update("kiosk-1", {"screens": ["lab"] * 17})


def test_mode_switch_clears_unsupported_theme():
    r, _ = reg()
    approved(r)                                                      # self
    r.admin_update("kiosk-1", {"theme": "Terminal/hacker"})
    out = r.admin_update("kiosk-1", {"mode": "kiosk"})
    assert out["theme"] == "" and out["screens"] == ["lab", "sessions"]
    r.admin_update("kiosk-1", {"mode": "self", "theme": "Terminal/hacker"})
    out = r.admin_update("kiosk-1", {"mode": "kiosk", "screens": ["sessions"]})   # with screens too
    assert out["theme"] == "" and out["screens"] == ["sessions"]
    r.admin_update("kiosk-1", {"theme": "Others/Claude"})
    assert r.admin_update("kiosk-1", {"mode": "self"})["theme"] == "Others/Claude"   # allowed: kept


def test_supplied_unsupported_theme_rejects():
    r, _ = reg(); r.kiosk_capable = True
    approved(r)
    before = r.snapshot()
    with pytest.raises(ValueError):
        r.admin_update("kiosk-1", {"theme": "Terminal/hacker"})
    with pytest.raises(ValueError):
        r.admin_update("kiosk-1", {"mode": "kiosk", "screens": ["lab"], "theme": "Vintage/VFD"})
    assert r.snapshot() == before
    assert r.admin_update("kiosk-1", {"mode": "self", "theme": "Vintage/VFD"})["theme"] == "Vintage/VFD"


def test_self_service_cannot_change_mode_or_screens():
    r, _ = reg(); r.kiosk_capable = True
    approved(r)
    out = r.self_update("kiosk-1", {"mode": "self", "screens": ["screen1"], "seconds": 40})
    assert out["mode"] == "kiosk" and out["screens"] == ["lab", "sessions"] and out["seconds"] == 40
    # The theme is checked against the STORED mode, not the ignored one in the body.
    with pytest.raises(ValueError):
        r.self_update("kiosk-1", {"mode": "self", "theme": "Terminal/hacker"})
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


def test_load_migrates_devices_without_mode():
    old = {"go": {"name": "Go", "auto_rotate": False, "seconds": 20, "theme": "Sci-Fi/TOS", "gear": True,
                  "caps": GO},
           "wide": {"name": "Wide", "auto_rotate": True, "seconds": 30, "theme": "Terminal/hacker",
                    "gear": False, "caps": LCD},
           "bad": {"name": "Bad", "mode": "tv", "screens": ["lab"], "caps": {}},
           "kept": {"name": "Kept", "mode": "kiosk", "screens": ["sessions", "zzz", "sessions"], "caps": {}}}
    r, _ = reg(); r.kiosk_capable = True
    r.load(old)
    s = r.snapshot()
    assert (s["go"]["mode"], s["go"]["screens"], s["go"]["seconds"], s["go"]["theme"]) == ("kiosk", ["lab", "sessions"], 20, "Sci-Fi/TOS")
    assert (s["wide"]["mode"], s["wide"]["theme"]) == ("kiosk", "")          # Terminal not a Kiosk theme
    assert (s["bad"]["mode"], s["bad"]["screens"]) == ("kiosk", ["lab", "sessions"])
    assert s["kept"]["screens"] == ["sessions"]
    r2, _ = reg()                                                            # no Kiosk data in this house
    r2.load(old)
    assert r2.snapshot()["go"]["mode"] == "self"
    assert r2.snapshot()["wide"]["theme"] == "Terminal/hacker"


def test_clean_devices_keeps_missing_mode_as_none():
    out = clean_devices({"go": {"name": "Go", "caps": {}}})
    assert out["go"]["mode"] is None and out["go"]["screens"] is None
    out = clean_devices({"go": {"name": "Go", "mode": "self", "screens": ["screen2"], "caps": {}}})
    assert out["go"]["mode"] == "self" and out["go"]["screens"] == ["screen2"]
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/bin/python -m pytest tests/test_devices.py -q`
Expected: the new tests fail with a KeyError on `mode` or a TypeError on `kiosk=`.

- [ ] **Step 3: Implement in `chiketi/devices.py`**

Add the imports `from chiketi import screens as SCREENS` and `from chiketi.config import TIMING`, plus `LOCAL_ID = "local"`. Then replace the functions below.

```python
def starting_settings(caps: dict, kiosk: bool = False) -> dict:
    touch = bool(caps.get("touch")) and caps.get("feed") != "picture"
    mode = "kiosk" if kiosk else "self"
    seconds = max(SECONDS_MIN, min(SECONDS_MAX, int(TIMING.rotate_interval_s)))
    return {"auto_rotate": not touch, "seconds": seconds, "theme": "", "gear": touch,
            "mode": mode, "screens": SCREENS.defaults(mode)}
```

In `_apply`, after the existing field checks and before `changed = …`, add the mode and screens handling. Then run the theme check against the resulting mode.

```python
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
```

Change the existing theme check to:

```python
    if "theme" in fields and "theme" in body:
        th = body["theme"]
        if not isinstance(th, str) or (th != "" and th not in THEMES):
            raise ValueError("unknown theme")
        if th and not SCREENS.theme_allowed(mode, th):
            raise ValueError(f"{th} is not a {mode} theme")
        new["theme"] = th
```

and move that block **after** the mode block, so it sees the resulting mode. Self-service passes `fields` without `mode`, so `mode` stays the stored one.

The admin fields become `("auto_rotate", "seconds", "theme", "gear", "name", "mode", "screens")`.

In `_clean_record`:

```python
    mode = raw.get("mode") if raw.get("mode") in SCREENS.MODES else None
    rec["mode"] = mode
    rec["screens"] = SCREENS.clean_screens(mode, raw.get("screens")) if mode else None
```

The base dict uses `**starting_settings({})`, so after that line, overwrite `mode` and `screens` with the values above. If `mode` is known and the theme is not allowed, set `rec["theme"] = ""`.

Add `_settle(rec)` to `DeviceRegistry`, and use it in `load()` and `register()`:

```python
    def _settle(self, rec: dict) -> None:
        """Fill in a saved device's missing mode/screens (records from before modes)."""
        if rec.get("mode") not in SCREENS.MODES:
            rec["mode"] = "kiosk" if self.kiosk_capable else "self"
            rec["screens"] = None
        if rec.get("screens") is None:
            rec["screens"] = SCREENS.defaults(rec["mode"])
        if rec.get("theme") and not SCREENS.theme_allowed(rec["mode"], rec["theme"]):
            rec["theme"] = ""
```

- `load()`: `self._devices = clean_devices(devices)`, then call `self._settle(rec)` for each record.
- `approve()`: `rec = {"name": "Display", **starting_settings(p["caps"], self.kiosk_capable), …}`.
- `__init__`: `self.kiosk_capable = False`.
- `_public()`: add `"mode": d["mode"], "screens": list(d["screens"])`.
- `snapshot()`: copy the screens list too: `{**v, "caps": dict(v["caps"]), "screens": list(v["screens"])}`.

```python
    def ensure_local(self, name: str) -> bool:
        """chiketi's own screen: approved, Self mode, no pairing. Keeps its settings."""
        with self._lock:
            if LOCAL_ID in self._devices:
                return False
            rec = {"name": "Display", **starting_settings({}), "caps": {}}
            rec.update(auto_rotate=True, gear=False)
            _apply(rec, {"name": name or "This screen"}, ("name",))
            self._devices[LOCAL_ID] = rec
            return True
```

(`ensure_local` ignores the `MAX_DEVICES` limit on purpose: there is only ever one local screen.)

- [ ] **Step 4: Set the default in `chiketi/config.py`**

Change it to `rotate_interval_s: int = 30`, with the comment `# starting seconds per screen for a new display`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `.venv/bin/python -m pytest tests/test_devices.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

`git commit -am "feat(devices): per-display mode and screens; migration of saved devices; the local screen"`

---

### Task 3: Server, state and app (`server.py`, `state.py`, `app.py`, `__main__.py`)

**Files:**
- Modify:
  - `chiketi/state.py`
  - `chiketi/server.py`:
    - globals `:104`;
    - `_validate_display_body` `:268-310`;
    - `_display_payload` `:430`;
    - `apply_saved_state` `:451`;
    - `_persist` `:491`;
    - `/api/themes` `:614`;
    - `do_POST` `:695-760`;
    - `_DISPLAY_ASSETS` `:968`;
    - the HTML builders `:982-1027`.
  - `chiketi/app.py:540-610`
  - `chiketi/__main__.py` (help text)
  - `tests/conftest.py:73`
- Test: `tests/test_state.py`, `tests/test_server.py`, `tests/test_server_devices.py`, `tests/test_app.py`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `/api/themes` gains `kiosk_theme`;
  - `POST /api/kiosk-theme/<family>/<variant>` returns `{"kiosk_theme": key}`;
  - `/api/display` loses `screen_rotation` and `default_duration`;
  - the `__SCREEN_SPEC_JSON__` placeholder is replaced in both pages;
  - `state` gains `kiosk_theme`, and `screen_rotation` is gone;
  - `state.migration_backup(path) -> str | None`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_state.py`, add:

```python
def test_kiosk_theme_and_no_screen_rotation(tmp_path, monkeypatch):
    from chiketi import state
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    p = tmp_path / "chiketi" / "state.json"; p.parent.mkdir()
    p.write_text(json.dumps({"version": 1, "theme": "Others/Claude",
                             "screen_rotation": {"screen6": {"enabled": False, "duration": 10}}}))
    s = state.load_state()
    assert "screen_rotation" not in s and s["kiosk_theme"] == "Others/Claude"
    p.write_text(json.dumps({"version": 1, "theme": "Terminal/hacker"}))
    assert state.load_state()["kiosk_theme"] == "Sci-Fi/TOS"
    p.write_text(json.dumps({"version": 1, "theme": "Terminal/hacker", "kiosk_theme": "Others/Claude"}))
    assert state.load_state()["kiosk_theme"] == "Others/Claude"
    p.write_text(json.dumps({"version": 1, "kiosk_theme": "Terminal/hacker"}))
    assert state.load_state()["kiosk_theme"] == "Sci-Fi/TOS"


def test_backup_before_migration_once(tmp_path, monkeypatch):
    from chiketi import state
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    p = tmp_path / "chiketi" / "state.json"; p.parent.mkdir()
    old = json.dumps({"version": 1, "devices": {"go": {"name": "Go", "caps": {}}}})
    p.write_text(old)
    state.load_state()
    baks = list(p.parent.glob("state.json.bak-*"))
    assert len(baks) == 1 and baks[0].read_text() == old
    p.write_text(json.dumps({"version": 1, "screen_rotation": {}}))
    state.load_state()                                                   # same day: kept, not replaced
    assert baks[0].read_text() == old
    for b in baks: b.unlink()
    p.write_text(json.dumps({"version": 1, "devices": {"go": {"name": "Go", "mode": "kiosk", "caps": {}}}}))
    state.load_state()
    assert not list(p.parent.glob("state.json.bak-*"))                   # nothing old: no backup


def test_house_state_migrates(tmp_path, monkeypatch):
    """The deployed house's file: two displays, Home Lab switched off house-wide."""
    from chiketi import server, state
    from chiketi.devices import DeviceRegistry
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    p = tmp_path / "chiketi" / "state.json"; p.parent.mkdir()
    p.write_text(json.dumps({"version": 1, "theme": "Others/Claude",
        "screen_rotation": {"screen6": {"enabled": False, "duration": 10}, "screen7": {"enabled": True, "duration": 10}},
        "devices": {"tablet-1": {"name": "Go", "auto_rotate": False, "seconds": 30, "theme": "Sci-Fi/TOS", "gear": True,
                                  "caps": {"w": 1800, "h": 1200, "touch": True}},
                    "wide-1": {"name": "Wide", "auto_rotate": True, "seconds": 15, "theme": "", "gear": False,
                                         "caps": {"w": 1920, "h": 462, "feed": "picture"}}}}))
    monkeypatch.setattr(server, "DEVICES", DeviceRegistry())
    server.DEVICES.kiosk_capable = True
    server.apply_saved_state(state.load_state())
    s = server.DEVICES.snapshot()
    for dev in ("tablet-1", "wide-1"):
        assert s[dev]["mode"] == "kiosk" and s[dev]["screens"] == ["lab", "sessions"]
    assert s["tablet-1"]["theme"] == "Sci-Fi/TOS" and s["wide-1"]["seconds"] == 15
    assert server._kiosk_theme == "Others/Claude"
```

Delete or replace the old `screen_rotation` state tests: every `test_state.py` test that asserts on `screen_rotation` becomes an assertion that the key is absent.

In `tests/test_server_devices.py`, add:

```python
def test_kiosk_theme_route():
    with _LiveServer() as srv:
        with pytest.raises(urllib.error.HTTPError) as e:
            call(srv, "POST", "/api/kiosk-theme/Others/Claude", {})
        assert e.value.code == 403                                         # token configured
        with pytest.raises(urllib.error.HTTPError) as e:
            call(srv, "POST", "/api/kiosk-theme/Others/Claude", {}, token=True, origin="http://evil.example")
        assert e.value.code == 403
        with pytest.raises(urllib.error.HTTPError) as e:
            call(srv, "POST", "/api/kiosk-theme/Terminal/hacker", {}, token=True)
        assert e.value.code == 400
        assert call(srv, "POST", "/api/kiosk-theme/Others/Claude", {}, token=True) == {"kiosk_theme": "Others/Claude"}
        assert call(srv, "GET", "/api/themes")["kiosk_theme"] == "Others/Claude"


def test_admin_mode_and_screens_over_http_self_service_cannot():
    with _LiveServer() as srv:
        call(srv, "POST", "/api/register", {"id": "kiosk-1", "caps": GO_CAPS})
        call(srv, "POST", "/api/devices/kiosk-1/approve", {"name": "Go"}, token=True)
        out = call(srv, "POST", "/api/devices/kiosk-1", {"mode": "kiosk", "screens": ["sessions"]}, token=True)
        assert out["mode"] == "kiosk" and out["screens"] == ["sessions"]
        out = call(srv, "POST", "/api/device/kiosk-1", {"mode": "self", "screens": ["screen1"]})
        assert out["mode"] == "kiosk" and out["screens"] == ["sessions"]
        assert call(srv, "GET", "/api/device/kiosk-1")["settings"]["screens"] == ["sessions"]
        with pytest.raises(urllib.error.HTTPError) as e:
            call(srv, "POST", "/api/devices/kiosk-1", {"screens": ["screen1"]}, token=True)
        assert e.value.code == 400
```

In `tests/test_server.py`:
- Delete the tests whose subject is `screen_rotation` (the merge, clamping, cap and copy tests listed by `grep -n screen_rotation tests/test_server.py`).
- Change the `default_duration` assertion (`:237`) to `assert "default_duration" not in data and "screen_rotation" not in data`.
- Add:

```python
def test_display_post_ignores_old_screen_rotation():
    with _LiveServer() as srv:
        data = _post(srv, "/api/display", {"brightness": 1.2, "screen_rotation": {"screen1": {"enabled": False}}})
        assert "screen_rotation" not in data and data["brightness"] == 1.2


def test_screens_json_is_in_the_display_build(monkeypatch):
    before = server._display_build()
    monkeypatch.setitem(server._UI_ASSET_CACHE, "screens.json", server._ui_asset("screens.json") + " ")
    assert server._display_build() != before


def test_pages_inline_the_screen_spec():
    for html in (server._build_display_html(), server._build_html()):
        assert "__SCREEN_SPEC_JSON__" not in html and '"sessions"' in html
```

(Use the file's existing POST helper; where the file names it differently, use that name.)

In `tests/test_app.py`:
- Replace the `screen_rotation` restore test (`:455-480`) with a test that `apply_saved_state` restores `kiosk_theme`.
- Add a test that `run(no_kiosk=False)` with Chromium patched out calls `DEVICES.ensure_local` and uses `display_url` ending in `/display?device=local`. Follow how the existing `run` tests patch `DisplayManager` and `start_server`.

In `tests/conftest.py`:
- Replace the `_screen_rotation` line with `monkeypatch.setattr(_server, "_kiosk_theme", "Sci-Fi/TOS", raising=False)`.

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/bin/python -m pytest tests/test_state.py tests/test_server.py tests/test_server_devices.py tests/test_app.py -q`
Expected: the new tests fail (no `kiosk_theme`, the route returns 404, the placeholder is still present).

- [ ] **Step 3: Implement `state.py`**

- Remove `_clean_rotation`, `_DURATION_*`, `_MAX_SCREEN_ROTATION` and `"screen_rotation"` from `DEFAULT_STATE` and `_defaults`. Add `"kiosk_theme": "Sci-Fi/TOS"`.
- In `_sanitize`, after the theme:

```python
    from chiketi import screens
    kt = raw.get("kiosk_theme")
    if isinstance(kt, str) and screens.theme_allowed("kiosk", kt):
        out["kiosk_theme"] = kt
    elif screens.theme_allowed("kiosk", out["theme"]):
        out["kiosk_theme"] = out["theme"]
    else:
        out["kiosk_theme"] = screens.default_theme("kiosk")
```

- Add the backup:

```python
def _needs_migration(raw) -> bool:
    if not isinstance(raw, dict):
        return False
    devices = raw.get("devices")
    old_device = isinstance(devices, dict) and any(
        isinstance(d, dict) and "mode" not in d for d in devices.values())
    return "screen_rotation" in raw or old_device


def migration_backup(path: str) -> str | None:
    """Copy state.json to state.json.bak-YYYYMMDD once, before an old file is rewritten."""
    import shutil
    import time
    bak = f"{path}.bak-{time.strftime('%Y%m%d')}"
    if os.path.exists(bak):
        return None
    try:
        shutil.copy2(path, bak)
        return bak
    except OSError:
        return None
```

- In `load_state`, after `raw = json.loads(blob)` and the version check, add `if _needs_migration(raw): migration_backup(path)`.

- [ ] **Step 4: Implement `server.py`**

- Delete `_screen_rotation`, `_MAX_SCREEN_ROTATION` and the `screen_rotation` branches in `_validate_display_body` and in the `/api/display` POST. The key is simply not read.
- Add the global `_kiosk_theme: str = "Sci-Fi/TOS"`.
- `_display_payload`: drop `screen_rotation` and `default_duration`.
- `apply_saved_state`: replace the rotation block with:

```python
        kt = saved.get("kiosk_theme")
        if isinstance(kt, str) and screens.theme_allowed("kiosk", kt):
            _kiosk_theme = kt
```

  (Add `global _kiosk_theme` and `from chiketi import screens` at module top.)
- `_persist` snapshot: replace `screen_rotation` with `"kiosk_theme": _kiosk_theme`.
- `/api/themes` response: add `"kiosk_theme": _kiosk_theme` (read under `_STATE_LOCK`).
- `do_POST`, before `/api/theme/`:

```python
        if path.startswith("/api/kiosk-theme/"):
            global _kiosk_theme
            key = path[len("/api/kiosk-theme/"):]
            if not screens.theme_allowed("kiosk", key):
                self.send_error(400, f"Not a kiosk theme: {key}")
                return
            with _STATE_LOCK:
                _kiosk_theme = key
            _persist()
            self._json_response({"kiosk_theme": key})
            return
```

  The token and Origin checks above it already apply, because the path is not self-service.
- `_DISPLAY_ASSETS`: add `"screens.json"`.
- Both builders: `.replace("__SCREEN_SPEC_JSON__", json.dumps(screens.SPEC))`, next to `__PANEL_SPEC_JSON__`.

- [ ] **Step 5: Implement `app.py` and `__main__.py`**

In `app.run`:

```python
    from chiketi.server import DEVICES
    from chiketi.screens import kiosk_capable
    DEVICES.kiosk_capable = kiosk_capable()
    display_url = f"http://localhost:{CONTROL_PORT}/display?device=local"
```

Set this before `apply_saved_state(saved)`, so the migration sees the capability. Then, right after `apply_saved_state`:

```python
    if not no_kiosk:
        import socket
        from chiketi.server import _persist
        if DEVICES.ensure_local(socket.gethostname()[:40]):
            _persist()
```

In `__main__.py`, change the `--rotate-interval` help to `"seconds per screen a new display starts with (default 30)"`.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `.venv/bin/python -m pytest -q`
Expected: all pass. Fix any other test that still references `screen_rotation` (grep for it).

- [ ] **Step 7: Lint and commit**

```bash
.venv/bin/ruff check chiketi/screens.py chiketi/devices.py chiketi/state.py chiketi/server.py chiketi/app.py tests/test_screens.py
git commit -am "feat(server): kiosk house theme, per-display screens replace screen_rotation, own screen as 'local'"
```

---

### Task 4: Shared screen logic and plan-driven tabs (`screen_functions.js`, harness)

**Files:**
- Modify: `chiketi/assets/ui/screen_functions.js` (the tabs at `:3618-3745`; remove `sfTngSessions`, `sfDs9Sessions`, `sfTngHomelab` and `sfDs9Homelab`; append the registry section at the end)
- Modify: `tests/js/render_harness.js`, `tests/js/fixtures.js` (add `KIOSK_EMPTY`)

**Interfaces:**
- Consumes: the global `SCREEN_SPEC` (defined by the page or the harness), and `m()`.
- Produces:
  - `themeAllowed(mode, key) -> bool`;
  - `screenReady(id) -> bool`;
  - `screenRenderer(id, family, variant) -> {fn, fluid} | null`;
  - `screenPlan({mode, screens, family, variant}) -> {mode, list: [{id, name, fn, fluid}], tabs: [{id, label, color, built, live}], fallback: bool, empty: bool}`;
  - `setTabPlan(tabs | null)`;
  - `kioskNotice(c)`.

  In Kiosk an empty plan has `list = [{id: 'none', name: 'No screens', fn: kioskNotice, fluid: true}]` and `empty: true`.

- [ ] **Step 1: Write the failing harness checks**

1. In `render_harness.js`, define `SCREEN_SPEC` before the eval:

```js
const SCREEN_SPEC = JSON.parse(fs.readFileSync(path.join(UI, 'screens.json'), 'utf8'));
```

2. Replace `REGISTRY` with entries built from the spec:

```js
const THEME_LIST = [];
for (const fam of Object.keys(FAMILIES)) for (const v of Object.keys(FAMILIES[fam])) THEME_LIST.push([fam, v]);
const REGISTRY = THEME_LIST.map(function (fv) {
  const key = fv[0] + '/' + fv[1];
  const ids = Object.keys(SCREEN_SPEC.modes).filter(function (md) { return themeAllowed(md, key); })
    .reduce(function (a, md) { return a.concat(SCREEN_SPEC.modes[md].screens); }, []);
  const screens = ids.map(function (id) { const r = screenRenderer(id, fv[0], fv[1]); return r && { id: id, fn: r.fn, fluid: r.fluid }; })
    .filter(Boolean);
  return { family: fv[0], variant: fv[1], screens: screens, fns: screens.map(function (s) { return s.fn; }) };
});
```

3. In the per-fixture loops, change the slot tests:
   - `i === 3` becomes `entry.screens[i].id === 'screen4'`;
   - labels use `entry.screens[i].id`;
   - the fluid loop iterates over `entry.screens.filter(s => ['screen5', 'sessions', 'lab'].indexOf(s.id) !== -1)` for every entry.

4. Add the new checks before the final report:

```js
/* ── Registry completeness ── */
THEME_LIST.forEach(function (fv) {
  const key = fv[0] + '/' + fv[1];
  ['screen1', 'screen2', 'screen3', 'screen4'].forEach(function (id) {
    if (!screenRenderer(id, fv[0], fv[1])) fail('REGISTRY', key, 'no renderer for ' + id);
  });
  if (fv[0] !== 'Terminal' && !screenRenderer('screen5', fv[0], fv[1])) fail('REGISTRY', key, 'no clock');
  SCREEN_SPEC.modes.kiosk.screens.forEach(function (id) {
    const built = SCREEN_SPEC.screens[id].built, r = screenRenderer(id, fv[0], fv[1]);
    if (themeAllowed('kiosk', key) && built && !r) fail('REGISTRY', key, 'no Kiosk renderer for ' + id);
    if (!themeAllowed('kiosk', key) && r) fail('REGISTRY', key, 'Kiosk renderer outside the Kiosk themes: ' + id);
  });
});
/* Every tab colour role exists in the Kiosk skins. */
[BS_SKIN_TOS, BS_SKIN_CLAUDE].forEach(function (skin) {
  SCREEN_SPEC.modes.kiosk.screens.forEach(function (id) {
    const col = SCREEN_SPEC.screens[id].color;
    if (col.charAt(0) !== '#' && !skin[col]) fail('REGISTRY', skin.key, 'tab colour role ' + col + ' missing');
  });
});

/* ── Plans: the Go bug. Every coloured tab leads to a listed screen, and no
   unselected screen has a tab. ── */
(function () {
  const kiosk = SCREEN_SPEC.modes.kiosk.screens;
  const cases = [];
  for (let mask = 0; mask < (1 << kiosk.length); mask += 5) cases.push(kiosk.filter(function (_, i) { return mask & (1 << i); }));
  cases.push(['sessions', 'lab'], ['lab'], [], kiosk.slice().reverse());
  ['FULL', 'HL_UNCONFIGURED', 'SESS_UNCONFIGURED', 'KIOSK_EMPTY'].forEach(function (fx) {
    metrics = FIX[fx];
    [['Sci-Fi', 'TOS'], ['Others', 'Claude']].forEach(function (fv) {
      cases.forEach(function (sel) {
        const label = fx + ' ' + fv[1] + ' [' + sel.join(',') + ']';
        const plan = screenPlan({ mode: 'kiosk', screens: sel, family: fv[0], variant: fv[1] });
        if (plan.tabs.map(function (t) { return t.id; }).join() !== sel.join()) fail('PLAN', label, 'tabs are not the selection');
        const listed = plan.empty ? [] : plan.list.map(function (s) { return s.id; });
        [600, 246].forEach(function (h) {
          setFrameH(h);
          setTabPlan(plan.tabs);
          const html = plan.list[0].fn(FAMILIES[fv[0]][fv[1]]);
          const ids = (html.match(/data-screen="([a-z0-9]+)"/g) || []).map(function (x) { return x.slice(13, -1); });
          if (ids.join() !== listed.join()) fail('PLAN', label + ' h=' + h, 'tappable tabs ' + ids.join() + ' != list ' + listed.join());
          if (plan.empty && html.indexOf('NO SCREENS TO SHOW') === -1) fail('PLAN', label, 'empty plan without the notice');
          const px = layoutPxHits(html);
          if (px.length) fail('PLAN', label + ' h=' + h, 'layout px -- ' + px.slice(0, 4).join(' '));
        });
      });
    });
  });
  setTabPlan(null); setFrameH(600); metrics = FIX.FULL;
  // Self fallbacks live in the plan too.
  let p = screenPlan({ mode: 'self', screens: [], family: 'Terminal', variant: 'hacker' });
  if (!(p.fallback && p.list.length === 1 && p.list[0].id === 'screen1')) fail('PLAN', 'self []', 'no fallback');
  p = screenPlan({ mode: 'self', screens: ['screen5'], family: 'Terminal', variant: 'hacker' });
  if (!(p.fallback && p.list[0].id === 'screen1')) fail('PLAN', 'self [clock] on Terminal', 'no fallback');
  p = screenPlan({ mode: 'self', screens: ['screen3', 'screen1'], family: 'Vintage', variant: 'VFD' });
  if (p.fallback || p.list.map(function (s) { return s.id; }).join() !== 'screen3,screen1') fail('PLAN', 'self order', 'order lost');
  p = screenPlan({ mode: 'kiosk', screens: ['overview', 'lab'], family: 'Sci-Fi', variant: 'TOS' });
  if (p.list.map(function (s) { return s.id; }).join() !== 'lab' || p.tabs[0].live) fail('PLAN', 'placeholder', 'grey tab live');
})();
```

5. In `fixtures.js`, add `KIOSK_EMPTY`: `FULL` with `homelab.status` and `sessions.status` both `{value: 'unconfigured', available: true, unit: '', extra: {}}`. The `HL_UNCONFIGURED` and `SESS_UNCONFIGURED` fixtures already exist.

- [ ] **Step 2: Run the harness and watch it fail**

Run: `node tests/js/render_harness.js`
Expected: `ReferenceError: themeAllowed is not defined`.

- [ ] **Step 3: Implement in `screen_functions.js`**

1. Replace `bsTabList()`:

```js
/* The tab bar is drawn from the display's plan (setTabPlan), so a coloured tab
   always leads to a screen the display has. Without a plan -- the harness, the
   site, a preview -- every Kiosk screen gets a tab, lit if it is built and has data. */
let TAB_PLAN = null;
function setTabPlan(tabs) { TAB_PLAN = Array.isArray(tabs) ? tabs : null; }
function bsTabList() {
  const S = bsS();
  const tabs = TAB_PLAN || SCREEN_SPEC.modes.kiosk.screens.map(function (id) {
    const s = SCREEN_SPEC.screens[id];
    return { id: id, label: s.label, color: s.color, built: s.built, live: s.built && screenReady(id) };
  });
  return tabs.map(function (t) {
    return { key: t.id, label: t.label, color: t.color.charAt(0) === '#' ? t.color : S[t.color],
             built: t.live, screen: t.live ? t.id : null };
  });
}
```

2. In `bsTabsColumn`, size the tabs to fit:

```js
  const tabs = bsTabList();
  const per = Math.min(40, Math.floor((frameH() - 12) / Math.max(1, tabs.length)));
  const icon = Math.min(30, Math.round(per * 0.75));
```

   and use `height:${gq(per)}` and `bsTabIcon(t.key, col, icon)`.

3. In `bsTabIcon`, add two pieces of art:

```js
    // Overview: a display wall of four panes, the top-left one lit.
    overview:
      `<rect x="4" y="6" width="40" height="30" rx="3" fill="${body}" ${st}/>` +
      `<rect x="8" y="10" width="15" height="10" rx="1.5" fill="#fff"/>` +
      `<rect x="25" y="10" width="15" height="10" rx="1.5" fill="${c}" opacity="0.7"/>` +
      `<rect x="8" y="22" width="15" height="10" rx="1.5" fill="${c}" opacity="0.5"/>` +
      `<rect x="25" y="22" width="15" height="10" rx="1.5" fill="${c}" opacity="0.35"/>` +
      `<path d="M17 42h14M24 36v6" ${st}/>`,
    // GPUs: a card with two fans, a white-hot core and its edge connector.
    gpus:
      `<rect x="3" y="12" width="42" height="22" rx="3" fill="${body}" ${st}/>` +
      `<circle cx="15" cy="23" r="7" fill="none" ${st}/><circle cx="33" cy="23" r="7" fill="none" ${st}/>` +
      `<circle cx="15" cy="23" r="2.5" fill="#fff"/><circle cx="33" cy="23" r="2.5" fill="#fff"/>` +
      `<path d="M8 34v5h6v-5M18 34v5h6v-5M28 34v5h6v-5" fill="${c}" opacity="0.6"/>`,
```

4. Remove `sfTngSessions`, `sfDs9Sessions`, `sfTngHomelab` and `sfDs9Homelab`.

5. Append the registry section:

```js
/* ── Screens: one description (screens.json, as SCREEN_SPEC) and one resolver ──
   screenRenderer says how a theme draws a screen; screenPlan says what a display
   shows. The display, the control panel, the harness and the site all use these. */
function themeAllowed(mode, key) {
  const md = SCREEN_SPEC.modes[mode];
  return !!md && (md.themes === 'all' || md.themes.indexOf(key) !== -1);
}
function screenReady(id) {
  const s = SCREEN_SPEC.screens[id];
  if (!s || !s.needs) return true;
  const st = m(s.needs + '.status');
  return st.available && st.value !== 'unconfigured';
}
function selfScreens(fam, v) {
  if (fam === 'Sci-Fi') {
    return v === 'DS9' ? [sfDs9Screen1, sfDs9NpuScreen, sfDs9ClaudeScreen, sfDs9GpuScreen, sfDs9Screen2]
      : v === 'TNG' ? [sfTngScreen1, sfTngNpuScreen, sfTngClaudeScreen, sfTngGpuScreen, sfTngScreen2]
      : [sfTosScreen1, sfTosNpuScreen, sfTosClaudeScreen, sfTosGpuScreen, sfTosScreen2];
  }
  if (fam === 'Vintage') {
    return v === 'Tubes' ? [tubeScreen1, tubeNpuScreen, tubeClaudeScreen, tubeGpuScreen, tubeScreen2]
      : v === 'VFD' ? [vfdScreen1, vfdNpuScreen, vfdClaudeScreen, vfdGpuScreen, vfdScreen2]
      : [scanScreen1, scanNpuScreen, scanClaudeScreen, scanGpuScreen, scanScreen2];
  }
  if (fam === 'Others') return [claudeScreen1, claudeNpuScreen, claudeClaudeScreen, claudeGpuScreen, claudeClockScreen];
  // The distro boards draw the time on screen 1, so Terminal has no clock screen.
  if (DISTRO_SCREENS[v]) return [DISTRO_SCREENS[v], DISTRO_AI_SCREENS[v], DISTRO_CLAUDE_SCREENS[v], DISTRO_GPU_SCREENS[v], null];
  return [terminalScreen1, terminalScreen2, terminalClaudeScreen, terminalGpuScreen, null];
}
const KIOSK_RENDERERS = {
  'Sci-Fi/TOS': { lab: sfTosHomelab, sessions: sfTosSessions },
  'Others/Claude': { lab: claudeHomelab, sessions: claudeSessions },
};
function screenRenderer(id, fam, v) {
  const k = KIOSK_RENDERERS[fam + '/' + v];
  if (k && k[id]) return { fn: k[id], fluid: true };
  const slot = /^screen([1-5])$/.exec(id);
  if (!slot) return null;
  const fn = selfScreens(fam, v)[Number(slot[1]) - 1];
  // The Sci-Fi and Claude clocks are fluid: they fill any landscape shape.
  return fn ? { fn: fn, fluid: id === 'screen5' && (fam === 'Sci-Fi' || fam === 'Others') } : null;
}
function screenPlan(o) {
  const mode = SCREEN_SPEC.modes[o.mode] ? o.mode : 'self';
  const md = SCREEN_SPEC.modes[mode];
  const sel = (Array.isArray(o.screens) ? o.screens : md.defaults).filter(function (id, i, a) {
    return md.screens.indexOf(id) !== -1 && a.indexOf(id) === i;
  });
  const list = [];
  sel.forEach(function (id) {
    const s = SCREEN_SPEC.screens[id];
    const r = s.built && screenReady(id) ? screenRenderer(id, o.family, o.variant) : null;
    if (r) list.push({ id: id, name: s.name, fn: r.fn, fluid: r.fluid });
  });
  const plan = { mode: mode, list: list, tabs: [], fallback: false, empty: false };
  if (mode === 'kiosk') {
    plan.tabs = sel.map(function (id) {
      const s = SCREEN_SPEC.screens[id];
      return { id: id, label: s.label, color: s.color, built: s.built,
               live: list.some(function (x) { return x.id === id; }) };
    });
    if (!list.length) {
      plan.empty = true;
      list.push({ id: 'none', name: 'No screens', fn: kioskNotice, fluid: true });
    }
  } else if (!list.length) {
    for (const id of md.screens) {
      const r = screenRenderer(id, o.family, o.variant);
      if (r) { list.push({ id: id, name: SCREEN_SPEC.screens[id].name, fn: r.fn, fluid: r.fluid }); break; }
    }
    plan.fallback = true;
  }
  return plan;
}
/* A Kiosk display with nothing to show: its own chrome, its tabs, and why. */
function kioskNotice(c) {
  bsSkin(activeFamily === 'Others' ? BS_SKIN_CLAUDE : BS_SKIN_TOS);
  const S = bsS();
  const text = 'NO SCREENS TO SHOW · CHOOSE THEM IN THE CONTROL PANEL';
  if (layoutClass() === 'strip') {
    return bsStripFrame({ active: '', status: S.edge, lead: '', leadColor: S.label, foot: '', footColor: S.dim, more: 0,
      body: `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:${S.dim};` +
        `font-size:${gq(18)};letter-spacing:${S.ls}">${text}</div>` });
  }
  const H = fluidH();
  return bsFrame(`<div style="position:absolute;left:0;right:0;top:50%;height:${gq(H)};transform:translateY(-50%)">` +
    bsHeader('') +
    `<div style="position:absolute;left:${gq(28)};right:${gq(28)};top:${gq(118)};bottom:${gq(40)};display:flex;` +
      `align-items:center;justify-content:center;text-align:center;color:${S.dim};font-size:${gq(30)};` +
      `letter-spacing:${S.ls}">${text}</div></div>`, true);
}
```

`kioskNotice` reads `activeFamily`. The display defines it. In the harness and the site generator's shim, add `var activeFamily = null;` if it is missing; the harness sets `activeFamily = fv[0]` before calling `plan.list[0].fn` in the plan loop.

- [ ] **Step 4: Run the harness and the JS check, and watch them pass**

Run: `node tests/js/render_harness.js && ./scripts/check_js.sh`
Expected: `renderer harness OK`, and every file `ok`.

- [ ] **Step 5: Commit**

`git commit -am "feat(ui): screenRenderer/screenPlan, tabs drawn from the plan, Overview and GPUs icons, Kiosk notice"`

---

### Task 5: The display (`display_app.js`, `pairing.js`)

**Files:**
- Modify: `chiketi/assets/ui/display_app.js` (registry `:90-147`, `buildEnabledScreens`/`renderDisplay`/`poll` `:150-215`, navigation `:300-345`, start `:347-364`)
- Modify: `chiketi/assets/ui/pairing.js` (`register`, `poll`, `chiketiPollDevice`)

**Interfaces:**
- Consumes: `screenPlan`, `setTabPlan`, `themeAllowed` (Task 4), and `kiosk_theme` (Task 3).
- Produces (for the browser checks): the globals `device`, `enabledScreens`, `currentScreenIdx`, `activeFamily`, `activeVariant`; `goToId(id)`; `window.__chiketiPolls` (a counter of committed polls).

This task's tests are the browser steps in Task 8 (steps 13–17), and they need Task 6's panel only for step 13. Write the code here, check it by hand with the steps below, and leave the automated checks to Task 8.

- [ ] **Step 1: Replace the registry and render code in `display_app.js`**

1. Delete `getScreenRegistry`, `buildEnabledScreens`, `screenRotation` and `defaultDuration`.
2. Add `const SCREEN_SPEC = __SCREEN_SPEC_JSON__;` after `PANEL_SPEC`, and the globals `let themeData = null, currentId = null, polling = false; const POLL_DEADLINE_MS = 8000;`.
3. Add:

```js
/* The theme this display shows: its own if its mode allows it, else its mode's
   house theme, else the mode's default. A Kiosk display never lands on Terminal. */
function resolveTheme(td) {
  const mode = device && SCREEN_SPEC.modes[device.mode] ? device.mode : 'self';
  const ok = function (k) {
    if (typeof k !== 'string') return false;
    const fv = k.split('/');
    return !!(td.families[fv[0]] && td.families[fv[0]][fv[1]]) && themeAllowed(mode, k);
  };
  const house = mode === 'kiosk' ? td.kiosk_theme : td.active_family + '/' + td.active_variant;
  const own = device && device.theme;
  return (ok(own) ? own : ok(house) ? house : SCREEN_SPEC.modes[mode].default_theme).split('/');
}

/* The one place settings become a screen: theme, plan, tabs and the current
   screen (kept by id) are worked out together and drawn in one step. */
function renderDisplay() {
  if (!themeData) return;
  const fv = resolveTheme(themeData);
  if (fv[0] !== activeFamily || fv[1] !== activeVariant) {
    activeFamily = fv[0]; activeVariant = fv[1]; currentId = null; lastRotate = Date.now();
  }
  themeColors = (themeData.families[activeFamily] || {})[activeVariant];
  if (!themeColors) return;
  const plan = screenPlan({ mode: device ? device.mode : 'self', screens: device ? device.screens : null,
                            family: activeFamily, variant: activeVariant });
  setTabPlan(plan.mode === 'kiosk' ? plan.tabs : null);
  enabledScreens = plan.list;
  let idx = enabledScreens.findIndex(function (s) { return s.id === currentId; });
  if (idx === -1) idx = 0;
  currentScreenIdx = idx;
  currentId = enabledScreens[idx].id;
  document.getElementById('display').innerHTML = enabledScreens[idx].fn(themeColors);
}
```

4. Replace `poll()`:

```js
/* One poll at a time, each with a deadline: a stalled request must not stop the
   display updating (or noticing a new build), and a failed batch commits nothing. */
async function poll() {
  if (polling) return;
  polling = true;
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, POLL_DEADLINE_MS);
  const get = function (p) {
    return fetch(API + p, { signal: ctl.signal }).then(function (r) {
      if (!r.ok) throw new Error(p + ' ' + r.status);
      return r.json();
    });
  };
  try {
    if (window.chiketiPollDevice) window.chiketiPollDevice();
    measureFrame();
    const got = await Promise.all([get('/api/themes'), get('/api/metrics'), get('/api/display')]);
    if (got[2].build && got[2].build !== BUILD) { location.reload(); return; }
    themeData = got[0]; metrics = got[1];
    window.__chiketiPolls = (window.__chiketiPolls || 0) + 1;
    renderDisplay();
    scheduleRotate();
    scheduleClockTick();
  } catch (e) {
    ctl.abort();      // the rest of the batch, if one request failed first
  } finally {
    clearTimeout(timer);
    polling = false;
  }
}
```

5. In `scheduleRotate`, the duration is always `device.seconds`:

```js
  if (enabledScreens.length <= 1 || !device || !device.auto_rotate) return;
  const durationMs = clampDuration(device.seconds) * 1000;
```

6. Navigation by ID:

```js
function onRotate() {
  const n = enabledScreens.length || 1;
  currentId = (enabledScreens[(currentScreenIdx + 1) % n] || {}).id || null;
  lastRotate = Date.now();
  renderDisplay(); scheduleRotate(); scheduleClockTick();
}
function goToId(id) {
  if (!enabledScreens.some(function (s) { return s.id === id; })) return;
  currentId = id;
  pauseUntil = Date.now() + PAUSE_MS;
  lastRotate = Date.now();
  renderDisplay(); scheduleRotate(); scheduleClockTick();
}
function goToScreen(idx) {
  const n = enabledScreens.length || 1;
  goToId(enabledScreens[((idx % n) + n) % n].id);
}
```

7. Pointer handling: take the tab at pointer-down.

```js
let swipeStart = null;
document.addEventListener('pointerdown', function (e) {
  const tab = e.target.closest && e.target.closest('[data-screen]');
  swipeStart = { x: e.clientX, y: e.clientY, pointer: e.pointerId, tab: tab ? tab.getAttribute('data-screen') : null };
});
document.addEventListener('pointerup', function (e) {
  const s = swipeStart;
  swipeStart = null;
  if (!s || e.pointerId !== s.pointer) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (Math.abs(dx) >= window.innerWidth * 0.08 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    goToScreen(currentScreenIdx + (dx < 0 ? 1 : -1));
    return;
  }
  // The redraw may have replaced the tab under the finger since pointer-down,
  // so go by the id taken then, whatever element this pointer-up landed on.
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && s.tab && s.tab !== currentId) goToId(s.tab);
});
```

8. Applying settings:

```js
window.chiketiApplyDevice = function (settings) {
  const before = JSON.stringify(device);
  device = settings;
  if (JSON.stringify(settings) === before) return;
  renderDisplay(); scheduleRotate(); scheduleClockTick();
};
```

   Delete the old theme-reset block in `poll` (`renderDisplay` handles it).

- [ ] **Step 2: Order every settings reply in `pairing.js`**

```js
  // Every reply that reaches handle() carries its request's number; an older
  // reply than the newest applied is dropped, so a slow one cannot roll the
  // display's settings back (a resize re-registers while polls carry on).
  var reqSeq = 0, appliedSeq = 0;
  function fresh(seq) {
    if (seq < appliedSeq) return false;
    appliedSeq = seq;
    return true;
  }
```

- In `register()`: `var seq = ++reqSeq;` before `xhr`. In its callback, after `retryDelay = 3000;`: `if (fresh(seq)) handle(out);`.
- `poll()`: `function poll() { var seq = ++reqSeq; xhr('GET', '/api/device/' + ID, null, function (out) { if (out && fresh(seq)) handle(out); }); }`
- `window.chiketiPollDevice = poll;`.

- [ ] **Step 3: Check syntax, start a dev server and look**

```bash
./scripts/check_js.sh && node tests/js/render_harness.js
rm -rf /tmp/chk-xdg && XDG_CONFIG_HOME=/tmp/chk-xdg .venv/bin/python -m chiketi --no-kiosk --bind 127.0.0.1 --token secret &
```

Open `/display?device=t1`, approve it through the API, set `{"mode": "kiosk", "screens": ["lab", "sessions"]}`, and check `enabledScreens.map(s => s.id)` in a headless page. Without data configured, expect `['none']` (the notice). Stop the server by killing the python PID.

- [ ] **Step 4: Commit**

`git commit -am "feat(display): one render state from the plan, ordered settings, poll deadline, taps by id"`

---

### Task 6: The control panel (`control_app.js`, `control.html`, `control.css`)

**Files:**
- Modify: `chiketi/assets/ui/control.html` (the `#deviceSettings` block, the theme controls, the Settings tab)
- Modify: `chiketi/assets/ui/control_app.js` (scope, picker, previews, rotation UI removed, `devSave`)
- Modify: `chiketi/assets/ui/control.css` (`.screen-pick` rows)

**Interfaces:**
- Consumes: `screenPlan`, `screenRenderer`, `screenReady`, `themeAllowed`, `setTabPlan` (Task 4); `/api/kiosk-theme` and `kiosk_theme` (Task 3); device `mode`/`screens` (Task 2).
- Produces (DOM IDs the checks use):
  - `input[name=devMode]` (values `kiosk`, `self`);
  - `#devScreens .pick-row[data-id]`, each with `input.pick-on`, `button.pick-up`, `button.pick-down` and `.pick-status`;
  - `#devWarn`;
  - `input[name=houseMode]`;
  - `#houseModeRow`.

- [ ] **Step 1: Change `control.html`**

Inside `#deviceSettings`, before Auto-rotate:

```html
  <div class="setting-row"><span class="setting-label">Mode</span>
    <label><input type="radio" name="devMode" value="kiosk"> Kiosk (house screens)</label>
    <label><input type="radio" name="devMode" value="self"> Self (this machine's stats)</label></div>
  <div class="setting-row" style="align-items:flex-start"><span class="setting-label">Screens</span>
    <div id="devScreens" class="screen-pick"></div></div>
  <div id="devWarn" class="device-warn"></div>
```

Inside `.theme-controls`, first:

```html
    <div id="houseModeRow" class="setting-row">House theme for
      <label><input type="radio" name="houseMode" value="kiosk"> Kiosk displays</label>
      <label><input type="radio" name="houseMode" value="self" checked> Self displays</label></div>
```

In the Settings tab:
- Rename `<h3>Display</h3>` to `<h3>This machine's screen</h3>`.
- Delete the whole "Screen Rotation" section.

- [ ] **Step 2: Change `control_app.js`**

1. Add `const SCREEN_SPEC = __SCREEN_SPEC_JSON__;` after `PANEL_SPEC`, and `let houseMode = 'self'; let pick = null;   // the selected display's screens draft: [{id, on}]`.
2. Delete `getScreenRegistry`, `renderScreenRotationUI`, `getScreenRotationFromUI`, `_serverScreenRotation`, `_serverDefaultDuration`, the `screen_rotation` lines in `loadSettings`, and `screen_rotation` in the `applySettings` body. Remove every call to `renderScreenRotationUI()`.
3. Add the helpers:

```js
function scopeMode() { const d = currentDevice(); return d ? d.mode : houseMode; }
function houseThemeKey(mode) {
  return mode === 'kiosk' ? currentData.kiosk_theme : currentData.active_family + '/' + currentData.active_variant;
}
/* The theme a display actually shows (same rules as the display). */
function liveThemeKey() {
  const d = currentDevice(), mode = scopeMode();
  if (d && d.theme && themeAllowed(mode, d.theme)) return d.theme;
  const h = houseThemeKey(mode);
  return themeAllowed(mode, h) ? h : SCREEN_SPEC.modes[mode].default_theme;
}
function allowedVariants(fam) {
  return Object.keys(currentData.families[fam] || {}).filter(function (v) { return themeAllowed(scopeMode(), fam + '/' + v); });
}
function pickFrom(d) {
  const all = SCREEN_SPEC.modes[d.mode].screens;
  const on = d.screens.filter(function (id) { return all.indexOf(id) !== -1; });
  return on.map(function (id) { return { id: id, on: true }; })
    .concat(all.filter(function (id) { return on.indexOf(id) === -1; }).map(function (id) { return { id: id, on: false }; }));
}
function pickedIds() { return pick ? pick.filter(function (p) { return p.on; }).map(function (p) { return p.id; }) : null; }
function screenStatus(id) {
  const s = SCREEN_SPEC.screens[id];
  if (!s.built) return 'coming soon';
  if (!screenReady(id)) return 'not set up';
  if (!screenRenderer(id, selectedFamily, selectedVariant)) return 'not in this theme';
  return 'ready';
}
function renderPick() {
  const box = document.getElementById('devScreens');
  const d = currentDevice();
  if (!d || !pick) { box.innerHTML = ''; return; }
  box.innerHTML = pick.map(function (p, i) {
    return `<div class="pick-row" data-id="${esc(p.id)}"><label><input type="checkbox" class="pick-on"${p.on ? ' checked' : ''}> ` +
      `${esc(SCREEN_SPEC.screens[p.id].name)}</label><span class="pick-status">${screenStatus(p.id)}</span>` +
      `<button class="setting-btn pick-up"${i ? '' : ' disabled'}>↑</button>` +
      `<button class="setting-btn pick-down"${i < pick.length - 1 ? '' : ' disabled'}>↓</button></div>`;
  }).join('');
  box.querySelectorAll('.pick-row').forEach(function (row, i) {
    row.querySelector('.pick-on').onchange = function (e) { pick[i].on = e.target.checked; pickChanged(); };
    row.querySelector('.pick-up').onclick = function () { pick.splice(i - 1, 0, pick.splice(i, 1)[0]); pickChanged(); };
    row.querySelector('.pick-down').onclick = function () { pick.splice(i + 1, 0, pick.splice(i, 1)[0]); pickChanged(); };
  });
  const warn = [];
  const plan = screenPlan({ mode: d.mode, screens: pickedIds(), family: selectedFamily, variant: selectedVariant });
  if (d.mode === 'kiosk' && d.caps && d.caps.layout === 'strip' && pickedIds().length > 5) {
    warn.push('The side column fits 5 at full size; icons will shrink.');
  }
  if (plan.empty) warn.push("This display will show 'No screens to show'.");
  document.getElementById('devWarn').textContent = warn.join(' ');
}
function pickChanged() { renderPick(); renderScreens(); }
```

4. `applyDeviceScope()`:
   - With a device: set the mode radio (`document.querySelector('input[name=devMode][value="' + d.mode + '"]').checked = true`) and `pick = pickFrom(d)`. The theme is `const key = liveThemeKey()`, giving `selectedFamily` and `selectedVariant` from the key.
   - House scope: `pick = null`, and the theme is `houseThemeKey(houseMode)`, falling back to the mode's `default_theme` if that is not allowed.
   - `document.getElementById('houseModeRow').hidden = !!d;`.
   - Then `renderPick()`.
5. `renderCategoryDropdown()` lists only families with at least one allowed variant. If `selectedFamily` is not among them, use the first one and `allowedVariants(first)[0]`. `sel.onchange` picks `allowedVariants(fam)[0]`.
6. `renderVariantRow()` loops over `allowedVariants(selectedFamily)`. The live marker is `liveThemeKey() === selectedFamily + '/' + name`. `lastLiveKey` uses `liveThemeKey()`. `renderPick()` runs at the end, because the statuses depend on the theme.
7. `selectTheme()`:

```js
    const key = family + '/' + variant;
    const res = selectedDevice ? await post(`/api/devices/${selectedDevice}`, { theme: key })
      : houseMode === 'kiosk' ? await post('/api/kiosk-theme/' + key)
      : await post('/api/theme/' + key);
```

   After success, reload devices or themes as before.
8. `renderScreens()`:

```js
function renderScreens() {
  const el = document.getElementById('screens'); el.innerHTML = '';
  const c = (currentData.families[selectedFamily] || {})[selectedVariant];
  if (!c) return;
  const mode = scopeMode();
  const d = currentDevice();
  const plan = screenPlan({ mode: mode, screens: d ? pickedIds() : SCREEN_SPEC.modes[mode].screens,
                            family: selectedFamily, variant: selectedVariant });
  activeFamily = selectedFamily;      // kioskNotice picks its skin from it
  for (const s of plan.list) {
    setTabPlan(plan.mode === 'kiosk' ? plan.tabs : null);
    const div = document.createElement('div');
    div.innerHTML = `<div class="screen-label">${esc(s.name)}</div>${s.fn(c)}`;
    el.appendChild(div);
  }
  setTabPlan(null);
  applyPreviewAspect();
}
```

   Add `let activeFamily = null;` to the control app's globals.
9. Mode radios (attach once at load):

```js
document.querySelectorAll('input[name=devMode]').forEach(function (r) {
  r.addEventListener('change', async function () {
    const res = await post(`/api/devices/${selectedDevice}`, { mode: r.value });
    document.getElementById('devStatus').textContent = res.ok ? 'Mode: ' + r.value : 'Failed to change mode';
    await loadDevices(); applyDeviceScope();
  });
});
document.querySelectorAll('input[name=houseMode]').forEach(function (r) {
  r.addEventListener('change', function () { houseMode = r.value; applyDeviceScope(); });
});
```

10. `devSave` body: add `screens: pickedIds()`.
11. In `loadDevices()`, the live-redraw check: compare `liveThemeKey()` with `lastLiveKey`. Redraw only the variant row (not the draft), so a pending edit survives the 3 s refresh.

- [ ] **Step 3: `control.css`**

```css
.screen-pick { display: flex; flex-direction: column; gap: 4px; }
.pick-row { display: flex; align-items: center; gap: 10px; min-height: 40px; }
.pick-row label { flex: 1; display: flex; align-items: center; gap: 8px; color: #ccc; }
.pick-status { color: #9aa0a6; font-size: 12px; min-width: 110px; }
.pick-row button:disabled { opacity: 0.3; }
.device-warn { color: #ffaa00; font-size: 12px; min-height: 16px; }
```

- [ ] **Step 4: Check syntax and look**

Run `./scripts/check_js.sh`. Start the dev server as in Task 5. Open `/` in a headless page with a device approved, and check:
- the mode radios;
- seven Kiosk rows;
- statuses "not set up" (Home Lab, Sessions) and "coming soon";
- the warning text;
- previews containing the notice.

Stop the server.

- [ ] **Step 5: Commit**

`git commit -am "feat(panel): mode, per-display screens with order and warnings, per-mode theme picker"`

---

### Task 7: The site generator (`gen_site_assets.py`, `docs/site`)

**Files:**
- Modify: `scripts/gen_site_assets.py` (shim `:96-140`), `tests/test_gen_site_assets.py` if it asserts on `siteScreens`
- Regenerate: `docs/site/*`

- [ ] **Step 1: Replace `siteScreens` in the shim**

```js
var SCREEN_SPEC = window.SCREEN_SPEC;
/* The Self set (this machine's stats) in each theme, from the same resolver as the kiosk. */
function siteScreens(family, variant){
  return SCREEN_SPEC.modes.self.screens.map(function (id) {
    var r = screenRenderer(id, family, variant);
    return r && { name: SCREEN_SPEC.screens[id].name, fn: r.fn };
  }).filter(Boolean);
}
```

Also:
- In `data.js`, add `"window.SCREEN_SPEC = " + (UI / "screens.json").read_text().strip() + ";\n"` next to `PANEL_SPEC`.
- Add `var activeFamily` (already in the shim).

- [ ] **Step 2: Regenerate and test**

```bash
.venv/bin/python scripts/gen_site_assets.py && .venv/bin/python -m pytest tests/test_gen_site_assets.py -q
git status --porcelain docs/
```

Expected: tests pass; `docs/site/data.js` and `docs/site/dashboard.js` changed.

- [ ] **Step 3: Check the site renders**

Load `docs/site/index.html` (or the page that includes `dashboard.js`) under `file://` in headless Chromium. Call `SITE_SCREENS('Terminal','hacker').length === 4` and `SITE_SCREENS('Sci-Fi','TOS').length === 5`.

- [ ] **Step 4: Commit**

`git commit -am "site: screens from screenRenderer; regenerate"`

---

### Task 8: Browser checks (`fit_check.mjs`, `devices_check.mjs`)

**Files:**
- Modify: `scripts/fit_check.mjs`, `scripts/devices_check.mjs`

- [ ] **Step 1: `fit_check.mjs`: stub an approved device**

Replace the `/api/display` route and add the device routes:

```js
const TABS = Number(process.env.TABS || 2);
const KIOSK = ['lab', 'sessions', 'overview', 'myday', 'home', 'harness', 'gpus'];
// ... per case:
const mode = /^screen/.test(sid) ? 'self' : 'kiosk';
const screens = mode === 'self' ? [sid] : [sid].concat(KIOSK.filter(k => k !== sid)).slice(0, Math.max(1, TABS));
const settings = { id: 'fit', name: 'fit', auto_rotate: false, seconds: 600, theme: fam + '/' + variant, gear: false, mode, screens };
await page.route('**/api/register', r => r.fulfill({ json: { status: 'approved', settings } }));
await page.route('**/api/device/**', r => r.fulfill({ json: { status: 'approved', settings } }));
```

- The themes route keeps setting `active_family`/`active_variant`, and also sets `j.kiosk_theme = fam + '/' + variant` when that is a Kiosk theme.
- The default `CASES` becomes `sessions:LIVE,sessions:FULL,sessions:SESS_MANY,sessions:SESS_OFFLINE,sessions:SESS_EMPTY,lab:FULL,lab:HL_RED,screen5:FULL`.
- `THEMES` becomes `[['Sci-Fi','TOS'], ['Others','Claude']]`, plus `['Sci-Fi','TNG'], ['Sci-Fi','DS9']` only for `screen*` cases (skip Kiosk cases on non-Kiosk themes).
- After the screenshot, a Kiosk case also checks that `document.querySelectorAll('[data-screen]')` values are a subset of `enabledScreens.map(s => s.id)`. Fail otherwise.

- [ ] **Step 2: `devices_check.mjs`: add steps 13–17 before `browser.close()`**

The new steps need Kiosk data on the dev server. Start it with a throwaway `sessions.toml` pointing at an unreachable feed (`url = "http://192.0.2.1:9/sessions"`), so `sessions.status` is `offline`, not `unconfigured`. Fake Home Lab readiness by routing `/api/metrics` in the page to the harness `FULL` fixture.

```js
// 13. Mode and screens reach an open display without a reload; the theme follows the mode.
const FIX = require('../tests/js/fixtures.js');
const kid = id + '-m';
const kctx = await browser.newContext({ viewport: { width: 1800, height: 1200 }, hasTouch: true });
const kp = await kctx.newPage();
await kp.route('**/api/metrics', r => r.fulfill({ json: FIX.FULL }));
await kp.goto(`${BASE}/display?device=${kid}`);
await kp.waitForSelector('#pairing:not([hidden])');
await api('POST', `/api/devices/${kid}/approve`, { name: 'Modes' });
await api('POST', `/api/devices/${kid}`, { mode: 'self', theme: 'Terminal/hacker' });
await kp.waitForFunction(() => activeFamily === 'Terminal' && enabledScreens[0].id === 'screen1', null, { timeout: 8000 });
await kp.evaluate(() => { window.__marker = 1; });
await api('POST', `/api/devices/${kid}`, { mode: 'kiosk' });
await kp.waitForFunction(() => activeVariant === 'TOS' && enabledScreens.map(s => s.id).join() === 'lab,sessions', null, { timeout: 8000 });
if (!(await kp.evaluate(() => window.__marker === 1))) fail('mode change reloaded the page');
console.log('ok   mode switch reaches the display; Kiosk falls back to TOS');

// 14. Tap each live tab; a tap straddling a redraw still navigates; a grey tab does nothing.
await api('POST', `/api/devices/${kid}`, { screens: ['sessions', 'overview', 'lab'] });
await kp.waitForFunction(() => enabledScreens.map(s => s.id).join() === 'sessions,lab', null, { timeout: 8000 });
for (const target of ['lab', 'sessions']) {
  await kp.tap(`[data-screen="${target}"]`);
  await kp.waitForFunction(t => enabledScreens[currentScreenIdx].id === t, target, { timeout: 3000 });
}
const grey = await kp.$$eval('[data-screen]', els => els.map(e => e.getAttribute('data-screen')));
if (grey.indexOf('overview') !== -1) fail('grey tab is tappable');
const box = await (await kp.$('[data-screen="lab"]')).boundingBox();
// A real tap is atomic, so dispatch its halves by hand with a redraw between.
await kp.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 7 }));
  renderDisplay();                                   // the redraw lands mid-tap
  document.elementFromPoint(x, y).dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 7 }));
}, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
await kp.waitForFunction(() => enabledScreens[currentScreenIdx].id === 'lab', null, { timeout: 3000 });
console.log('ok   tabs navigate, also across a redraw; grey tabs do not');

// 15. A reorder keeps the current screen; into and out of an empty Kiosk plan.
await api('POST', `/api/devices/${kid}`, { screens: ['lab', 'sessions'] });
await kp.waitForFunction(() => enabledScreens.map(s => s.id).join() === 'lab,sessions' && enabledScreens[currentScreenIdx].id === 'lab', null, { timeout: 8000 });
await api('POST', `/api/devices/${kid}`, { screens: ['overview'] });
await kp.waitForFunction(() => /NO SCREENS TO SHOW/.test(document.getElementById('display').textContent), null, { timeout: 8000 });
await api('POST', `/api/devices/${kid}`, { screens: ['sessions'] });
await kp.waitForFunction(() => enabledScreens[0].id === 'sessions', null, { timeout: 8000 });
console.log('ok   reorder keeps the screen; empty plan shows the notice and recovers');

// 16. Out-of-order replies do not roll settings back.
const oid = id + '-o';
const octx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
const op2 = await octx.newPage();
let holdRegister = null;
await op2.route('**/api/register', async r => {
  if (holdRegister === null) { holdRegister = false; return r.continue(); }
  const resp = await r.fetch();              // answer now, deliver late: older settings
  const body = await resp.json();
  holdRegister = () => r.fulfill({ json: body });
});
await op2.goto(`${BASE}/display?device=${oid}`);
await op2.waitForSelector('#pairing:not([hidden])');
await api('POST', `/api/devices/${oid}/approve`, { name: 'Order' });
await op2.waitForSelector('#display .screen-frame', { timeout: 8000 });
await op2.setViewportSize({ width: 1000, height: 600 });               // resize -> re-register (held)
for (let i = 0; i < 20 && typeof holdRegister !== 'function'; i++) await op2.waitForTimeout(200);
await api('POST', `/api/devices/${oid}`, { seconds: 77 });
await op2.waitForFunction(() => device.seconds === 77, null, { timeout: 8000 });
await holdRegister();                                                   // the stale reply lands now
await op2.waitForTimeout(500);
if ((await op2.evaluate(() => device.seconds)) !== 77) fail('a late registration reply rolled settings back');
console.log('ok   late replies are dropped');

// 17. A stalled poll recovers without a reload (request held; body stalled).
let stall = 'request';
await op2.route('**/api/metrics', async r => {
  if (stall === 'request') return;                                        // never answered
  if (stall === 'body') { stall = null; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"cpu.usage":' }); }
  return r.continue();
});
const before = await op2.evaluate(() => window.__chiketiPolls);
await op2.waitForTimeout(9000);                                           // past the 8 s deadline
stall = 'body';
await op2.waitForFunction(b => window.__chiketiPolls > b, before, { timeout: 20000 });
await op2.evaluate(() => { window.__marker2 = 1; });  // set before the stall in the real script
if (!(await op2.evaluate(() => !!document.querySelector('#display .screen-frame')))) fail('display lost its render');
console.log('ok   stalled polls recover');
await api('POST', `/api/devices/${kid}/forget`, {});
await api('POST', `/api/devices/${oid}/forget`, {});
```

Also update step 2: its starting-settings check becomes `s.auto_rotate === false && s.gear === true && s.mode === 'kiosk'`, because the dev server has `sessions.toml`.

In step 17, the truncated body makes `.json()` reject, which counts as a failed batch. Only a poll that commits bumps `__chiketiPolls`.

- [ ] **Step 3: Run the browser checks**

```bash
rm -rf /tmp/chk-xdg && mkdir -p /tmp/chk-xdg/chiketi && printf 'url = "http://192.0.2.1:9/sessions"\n' > /tmp/chk-xdg/chiketi/sessions.toml
XDG_CONFIG_HOME=/tmp/chk-xdg .venv/bin/python -m chiketi --no-kiosk --bind 127.0.0.1 --token secret &
node scripts/devices_check.mjs
SHAPES=1800x1200,1920x462 TABS=2 node scripts/fit_check.mjs
SHAPES=1800x1200,1920x462 TABS=5 CASES=sessions:FULL,lab:FULL node scripts/fit_check.mjs
SHAPES=1800x1200,1920x462 TABS=7 CASES=sessions:FULL,lab:FULL node scripts/fit_check.mjs
```

Expected: `devices check OK`, and every fit case `ok`. Stop the server by killing its PID.

- [ ] **Step 4: Commit**

`git commit -am "test: browser checks for modes, tabs across redraws, ordered replies, stalled polls"`

---

### Task 9: Docs and the final gate

**Files:**
- Modify: `CLAUDE.md`, `README.md` (`:105`, `:224`, and a new section), `CHANGELOG.md`

- [ ] **Step 1: Write the docs**

`CLAUDE.md`:
- Replace the bullet "**The screen registry exists three times** …" with:

  > **Screens are described once**: `assets/ui/screens.json` (modes, their themes and screens, tab label/colour, the data a screen needs) is read by `chiketi/screens.py` for validation and inlined as `SCREEN_SPEC`; `screenRenderer(id, family, variant)` and `screenPlan()` at the end of `screen_functions.js` say how a theme draws a screen and what a display shows. The tab bar is drawn from the plan.

- In "Adding a screen with the shared header": replace "registry entries ×3 … a tab in `bsTabList` (set `built` and `screen`)" with "an entry in `screens.json` (set `built`), its renderer in `KIOSK_RENDERERS`, its tab art in `bsTabIcon`".
- In "Devices and pairing": add one sentence: each device has a `mode` (`kiosk`/`self`) and an ordered `screens` list, set from the control panel only. chiketi's own screen is the device `local`.

`README.md`:
- Add a "Screen modes" section: Kiosk (house screens with tabs; TOS and Claude) and Self (the machine's own stats; every theme). Each display picks its mode and screens in the control panel.
- `--rotate-interval`: "Seconds per screen a new display starts with (default 30)".

`CHANGELOG.md`: an Unreleased entry listing:
- modes;
- per-display screens;
- `screen_rotation` removed and its migration;
- `kiosk_theme`;
- the local screen;
- the Go tab fix.

- [ ] **Step 2: The full gate**

```bash
.venv/bin/python -m pytest -q
node tests/js/render_harness.js
./scripts/check_js.sh
.venv/bin/ruff check chiketi/screens.py chiketi/devices.py chiketi/state.py chiketi/server.py chiketi/app.py chiketi/__main__.py chiketi/config.py tests/test_screens.py tests/test_devices.py tests/test_server_devices.py scripts/gen_site_assets.py
.venv/bin/chiketi-site check --site examples/site
.venv/bin/python scripts/gen_site_assets.py && git status --porcelain docs/
shellcheck scripts/*.sh
```

Expected:
- all tests pass;
- `renderer harness OK`;
- every JS file `ok`;
- no ruff findings in the changed lines;
- the site check is OK;
- the docs are clean after a regenerate.

- [ ] **Step 3: Commit**

`git commit -am "docs: screen modes"`

---

## Revisions from review (binding: each overrides the task text it names)

**R1 (Task 3, `state.py`).** Removing `_clean_rotation` also removes its call: delete
`out["screen_rotation"] = _clean_rotation(raw.get("screen_rotation"))` from `_sanitize()`.
Add `test_migrated_state_round_trips`: load an old file, `save_state(snapshot)`, then
`load_state()` again. Devices (with `mode` and `screens`), `theme`, `kiosk_theme`,
`brightness`, `output`, `width` and `height` all survive, and `save_state` returns True.

**R2 (Task 4, harness: skins).** `const` bindings from the harness eval are invisible
outside it. Append to the concatenated eval source:
`'\nglobalThis.__HARNESS = { skins: [BS_SKIN_TOS, BS_SKIN_CLAUDE] };'`.
The skin-role check then iterates `__HARNESS.skins`.

**R3 (Tasks 4–6: an empty Kiosk plan).** `screenPlan` keeps `list: []` and sets
`empty: true`; it never inserts a `none` entry. The consumers draw the notice:
- **Display:** `enabledScreens = plan.empty ? [NOTICE] : plan.list`, with
  `const NOTICE = { id: 'none', name: 'No screens', fn: kioskNotice, fluid: true };`.
  `scheduleRotate` already stops at one screen, and `goToId` ignores IDs that are not
  listed. A tab never names `none`.
- **Previews:** `const shown = plan.empty ? [NOTICE] : plan.list;`, with the same
  `NOTICE` defined in `control_app.js`.
- **Harness:** draws `plan.empty ? kioskNotice : plan.list[0].fn`.

**R4 (Task 4, harness: independent expectations).** Each fixture has a fixed set of
ready screens: `{FULL: ['lab','sessions'], HL_UNCONFIGURED: ['sessions'],
SESS_UNCONFIGURED: ['lab'], KIOSK_EMPTY: []}`. For each case,
`expected = sel.filter(id => READY[fx].includes(id))`. The checks:
- `plan.list` IDs equal `expected`;
- the tappable `data-screen` IDs in the HTML equal `expected`;
- `plan.empty === (expected.length === 0)`;
- every tab whose ID is not in `expected` has `live === false`;
- there is one `data-tab` per selected ID, in order.

The FULL fixture must also produce `['lab','sessions']` for `sel = ['lab','sessions']`,
which checks both screens positively.

**R5 (Task 4, tab markup).** Every tab element (live or grey, header and column) carries
`data-tab="<id>"`; only live tabs also carry `data-screen`. The harness and fit_check
assert on `data-tab` for count and order.

**R6 (Task 8, devices_check step 8).** New devices start in Kiosk on the dev server, so
after approving `pid`, call `api('POST', /api/devices/${pid}, {mode: 'self'})` and
`await panel.waitForFunction(() => document.querySelector('input[name=devMode][value=self]').checked)`
before clicking TNG.

**R7 (Task 8, step 17: a real stall).** `devices_check.mjs` starts its own
`http.createServer` on `127.0.0.1:0` with two paths:
- `/hold` never answers;
- `/body` sends `200`, `Content-Type: application/json` and `{"cpu.usage":`, then holds
  the socket open.

Each stall phase routes `**/api/metrics` with `r.continue({ url: stallBase + '/hold' })`
(then `/body`). The checks:
1. Set `window.__marker = 1` before the first stall.
2. During each stall (wait 9 s), `__chiketiPolls` must not increase: nothing is
   committed.
3. Then route metrics to `FIX.FULL` with `sys.hostname` set to `after-stall`. Assert
   that `__chiketiPolls` increases and that `metrics['sys.hostname'].value === 'after-stall'`.
4. Assert `window.__marker === 1` (no reload).

Close the stall server at the end.

**R8 (Task 8, the missing interactions).** Add these steps:

**18. Control panel UI** on the device from step 13:
1. Select it in `#deviceSelect`.
2. Click the `self` mode radio. Expect the API to show `mode === 'self'` and the open
   display to show `screen1`.
3. Click `kiosk`.
4. Untick Home Lab (`.pick-row[data-id=lab] .pick-on`).
5. Click `.pick-row[data-id=sessions] .pick-up` until Sessions is first.
6. Tick Overview, then click `#devSave`.
7. Expect the API to show `screens === ['sessions','overview']`, the open display to
   show `enabledScreens` IDs equal to `['sessions']`, and its `[data-tab]` order to be
   `sessions,overview`.

**Grey tab.** Tap the element `[data-tab=overview]` with `kp.tap`, and assert that the
current screen ID is unchanged.

**Same theme.** Set `{mode: 'self', theme: 'Sci-Fi/TOS'}` and wait for `screen1`. Then
set `{mode: 'kiosk'}` and assert:
- `activeVariant === 'TOS'`;
- `enabledScreens[0].id` is a Kiosk ID;
- `window.__marker === 1`.

**Delayed device-status reply.** On page `op2`, hold the next `**/api/device/**` reply.
To do it, fetch it, store `() => r.fulfill({ json: body })`, and continue every later
one. Then:
1. Post `{seconds: 88}`.
2. Wait until `device.seconds === 88` (a later poll).
3. Release the held reply, which carries the old seconds.
4. Assert that `device.seconds` stays 88 after 500 ms.

**R9 (Task 8, fit_check exactness).** Before measuring, wait for
`enabledScreens[currentScreenIdx].id === sid`. For a Kiosk case, assert:
- the `[data-tab]` IDs equal `screens`;
- the `[data-screen]` IDs equal the ready subset in selection order. With `FULL`
  metrics, that is `screens.filter(id => ['lab','sessions'].includes(id))`. With `LIVE`,
  it is read from `/api/metrics` the same way.

**R10 (Task 9, `check_js.sh`).** Add a second pass to `scripts/check_js.sh`:

```bash
tmp=$(mktemp -d)
.venv/bin/python - "$tmp" <<'PY' || status=1
import re, sys
from chiketi import server
out = sys.argv[1]
bad = 0
for name, html in (("display", server._build_display_html()), ("control", server._build_html())):
    left = sorted(set(re.findall(r"__[A-Z][A-Z_]+__", html)))
    if left:
        print(f"FAIL {name}: placeholders left: {left}"); bad = 1
    for i, block in enumerate(re.findall(r"<script>(.*?)</script>", html, re.S)):
        open(f"{out}/{name}-{i}.js", "w").write(block)
sys.exit(bad)
PY
for f in "$tmp"/*.js; do
    if node --check "$f" 2>/dev/null; then echo "ok   built $(basename "$f")"
    else echo "FAIL built $(basename "$f")"; node --check "$f" || true; status=1; fi
done
rm -rf "$tmp"
```

The python interpreter is `${CHIKETI_PYTHON:-.venv/bin/python}`, falling back to
`python3`. CI installs the package, so use `PY=${CHIKETI_PYTHON:-python3}` there. The
browser checks (Tasks 5 and 8) are the runtime smoke test. Each also fails on any
`pageerror`: add `page.on('pageerror', e => fail('page error: ' + e.message))` to every
page they open.

**R11 (Task 3, a safe backup).** `migration_backup(path, blob: bytes) -> str | None`
writes the bytes `load_state()` already read:

```python
    fd = os.open(bak, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(blob)
```

It catches `FileExistsError` and any other `OSError`, returning `None`, and never
overwrites. `load_state` reads the file as bytes for this (decode with `errors="replace"`
for parsing, exactly as today). Tests:
- the backup equals the bytes read even if the file is replaced afterwards;
- a symlink already at the backup path is left alone and not followed (its target is
  unchanged);
- an existing backup is never overwritten.

**R12 (Task 2, `local` and the device cap).** `clean_devices` skips non-`local` entries
beyond `MAX_DEVICES` (`continue`, not `break`), and always keeps `local`. `approve()`
counts only non-`local` devices against `MAX_DEVICES`.
`test_local_survives_full_registry`: 32 devices plus `local` with `seconds: 45` round-trip
through `snapshot()` → `clean_devices()` → `load()`, and `local` keeps 45.

**R13 (Task 3, persist the migration at start-up).**
- `load_state()` adds `"migrated": True` to its result when `_needs_migration(raw)`
  holds or `kiosk_theme` was missing. `_sanitize` does not keep it.
- New `server.adopt_saved_state(saved: dict, own_screen: bool) -> None` does three
  things:
  1. calls `apply_saved_state(saved)`;
  2. calls `ensure_local(socket.gethostname()[:40])` when `own_screen`;
  3. calls `_persist()` if `saved.get("migrated")` or a local device was created.
- `app.run` calls `adopt_saved_state(saved, own_screen=not no_kiosk)` instead of
  `apply_saved_state` plus the Task 3 Step 5 block.
- Tests:
  - an old file with `own_screen=False` is rewritten (it reloads with `mode` present and
    no `screen_rotation`);
  - a second start makes no new backup and no write;
  - with `own_screen=True`, `local` is created once.

**R14 (Task 2, timing).** Update `tests/test_config.py`'s assertion to
`Timing().rotate_interval_s == 30`. Add `test_rotate_interval_seeds_new_devices`: with
`TIMING.rotate_interval_s` patched to 12, a newly approved device has `seconds == 12`,
and a loaded saved device keeps its own seconds.

### Revisions, round 2

**R15 (Task 6, a mode changed elsewhere; Task 8 step 8).**
- `loadDevices()` keeps `lastModeKey = d ? d.mode + '|' + d.screens.join() : null`.
  When it changes for the selected device, it calls `applyDeviceScope()`, which sets the
  radio, rebuilds `pick` from the server, and redraws the picker, previews and theme row.
  So a mode or screens change made elsewhere shows up, and an edit in progress is
  replaced only when the server's mode or screens actually changed.
- In step 8, R6 changes to: click `input[name=devMode][value=self]` in the panel, then
  wait until the API reports `mode === 'self'` before clicking TNG.

**R16 (Task 8, order of the steps and cleanup).**
- Steps 13–18, R7 and R8 run in this order:
  1. 13 (mode switches, including "same theme");
  2. 14 (tabs, grey tab);
  3. 15 (reorder, empty plan);
  4. 18 (panel UI on `kid`);
  5. 16 (late registration reply on `oid`);
  6. R8's delayed device-status reply (on `oid`);
  7. 17 (stalls on `oid`).
- Every `forget`, every `context.close()` and the stall server's `close()` move into
  one final cleanup block after step 17.

**R17 (Task 8 step 17, proving nothing is committed).**
1. Before the stalls, route `**/api/themes` to the real response with
   `active_variant` intact, and `**/api/metrics` to `FIX.FULL` with `sys.hostname` set
   to `before-stall`.
2. Wait for a committed poll showing `before-stall`. Record
   `snap = {html: display.innerHTML, theme: activeFamily + '/' + activeVariant, host: metrics['sys.hostname'].value, polls: __chiketiPolls}`.
   The device is in Self mode with only `screen1`, which shows the hostname, and
   auto-rotate is off.
3. During each stall, re-route `**/api/themes` to return `Others/Claude`, a distinguishable
   success, so a partial commit would change the theme.
4. Wait until the stall server has received the request (it counts hits), then wait 9 s.
   Assert that `activeFamily/activeVariant`, `metrics['sys.hostname'].value` and
   `__chiketiPolls` all equal `snap`. Assert that `display.innerHTML` still contains
   `before-stall`. A clock redraw may change the digits, so don't compare the whole HTML.
5. Afterwards, restore the themes route and route metrics to `after-stall`. Assert the
   commit shows `after-stall`, and that `window.__marker === 1`.

**R18 (Task 3, a backup that is complete or absent).** `migration_backup(path, blob)`:
1. `tmp = bak + '.tmp-' + str(os.getpid())`.
2. Create `tmp` with `os.open(tmp, O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW, 0o600)`, write
   `blob`, `flush` and `os.fsync`.
3. Publish with `os.link(tmp, bak)`. This is atomic and fails with `FileExistsError` if
   `bak` exists, a symlink included.
4. `os.unlink(tmp)` in `finally`.

It returns `"made"`, `"exists"` (a backup is already there) or `None` (failed; the
partial temp file is removed).

`load_state` records the result:
- When migrating, it sets `saved["migrated"] = True`.
- If the backup returned `None`, it also sets `saved["backup_failed"] = True` and prints
  `chiketi: could not back up state.json before migrating; leaving it unchanged until settings change`.

`adopt_saved_state` skips its start-up `_persist()` when `backup_failed`. The file is then
only rewritten when someone changes a setting.

Tests:
- a write failure (monkeypatch `os.fsync` to raise) leaves no `bak` and no temp file,
  sets `backup_failed`, and causes no start-up write;
- a later run with `fsync` restored makes the backup.

**R19 (Task 5, input before the first render).** `goToScreen` and `goToId` return
immediately when `enabledScreens.length === 0`. `onRotate` does the same. In
devices_check step 1 (a pending display), press `1`, `Space`, and swipe, and assert no
`pageerror` (R10's handler) and that the pairing page is still shown.

**R20 (Task 2, an exact approval response).** In `tests/test_devices.py`, the exact
dictionary in the approval test (`:63` area) gains
`"mode": "self", "screens": ["screen1", "screen2", "screen3", "screen4", "screen5"]`. It
stays an exact comparison. Do the same in any other test comparing a whole `_public()`
dictionary; find them with `grep -n '"gear":' tests/`.

### Revisions, round 3

**R21 (Task 6, a draft's baseline belongs to its device).** `applyDeviceScope()` sets
`pickBase = d ? d.id + '|' + d.mode + '|' + d.screens.join() : null` whenever it builds
`pick`. `loadDevices()` compares the selected device's current
`d.id + '|' + d.mode + '|' + d.screens.join()` with `pickBase`, and calls
`applyDeviceScope()` only if they differ. Switching devices therefore resets the baseline
at once, and a refresh never discards an edit unless the server changed that device.

devices_check step 18 adds the case:
1. Select device A.
2. Select device B and untick a box at once.
3. Wait 3.5 s, past one refresh.
4. Assert the box is still unticked.

**R22 (Task 8, the uppercase hostname).** The TOS System Stats screen uppercases the
hostname. R17's render checks therefore use
`display.textContent.toUpperCase().includes('BEFORE-STALL')` (and `'AFTER-STALL'`),
while the metric checks compare `metrics['sys.hostname'].value` exactly in lowercase.

**R23 (Task 3, the backup is a precondition of every save; replaces R11, R13 and R18's
mechanics).**
- `load_state()` makes no backup. When `_needs_migration(raw)` holds, it adds
  `"migrated": True` and `"migration_blob": <the bytes it read>` to its result.
  `_sanitize` keeps neither.
- `server.adopt_saved_state(saved, own_screen)`:
  1. sets the global `_pending_backup = saved.get("migration_blob")`;
  2. calls `apply_saved_state(saved)`;
  3. calls `ensure_local` when `own_screen`;
  4. calls `_persist()` if migrated or local was created.
- `_persist()`, inside `_PERSIST_LOCK` and before building the snapshot:

```python
            global _pending_backup
            if _pending_backup is not None:
                from chiketi.state import migration_backup, state_path
                if migration_backup(state_path(), _pending_backup) is None:
                    return          # no usable backup: keep the old file untouched
                _pending_backup = None
```

  Every write path goes through `_persist()`: start-up, admin routes, the coalesced
  self-service flush and capability changes. No write can replace the old file without
  a complete backup, and each later write retries the backup.

`migration_backup(path, blob) -> "made" | "exists" | None`:
1. Use `os.lstat(bak)` first:
   - a **regular file** returns `"exists"`;
   - anything else that exists (a symlink, dangling or not, a directory, a FIFO) returns
     `None`, leaving it untouched;
   - if nothing exists, go on.
2. Write `tmp = f"{bak}.tmp-{os.getpid()}"` with
   `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW, 0o600`, then write, `flush` and `fsync`.
3. Run `os.link(tmp, bak)`. On `FileExistsError`, re-run the `lstat` check, which lands
   on `"exists"` or `None`.
4. Unlink `tmp` in `finally`. Any `OSError` returns `None`.

Tests (`tests/test_state.py`, `tests/test_server.py`):
- **Made:** the backup equals the bytes read even after the source is replaced, and it is
  made once (`"exists"` the second time).
- **Dangling symlink at `bak`:** with an old file, `adopt_saved_state(saved, False)` leaves
  the source byte-for-byte unchanged and the symlink untouched. A later `_persist()` (a
  setting changed) also leaves it unchanged.
- **Failed write:** with `os.fsync` monkeypatched to raise, there is no `bak` and no temp
  file, and the source is unchanged after `adopt_saved_state` **and** after a
  registration whose capabilities changed (call `DEVICES.register` and `_persist()`
  directly). With `fsync` restored, the next `_persist()` makes the backup and then
  writes the migrated file.
- **Second start:** a second start with the migrated file sets no `migration_blob`, makes
  no backup and does no start-up write.

`tests/conftest.py` resets `_pending_backup` to `None`.
