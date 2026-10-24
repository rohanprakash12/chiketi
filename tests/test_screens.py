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
    built = [s for s in screens.mode_screens("kiosk") if screens.SPEC["screens"][s]["built"]]
    assert built == ["lab", "sessions", "gpus"]


def test_defaults_and_themes():
    for mode in screens.MODES:
        assert set(screens.defaults(mode)) <= set(screens.mode_screens(mode))
        assert screens.default_theme(mode) in THEMES
        assert screens.theme_allowed(mode, screens.default_theme(mode))
    assert screens.defaults("kiosk") == ["lab", "sessions", "gpus"]
    d = screens.defaults("kiosk")
    d.append("x")
    assert screens.defaults("kiosk") == ["lab", "sessions", "gpus"]          # a copy
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
    d = tmp_path / "chiketi"
    d.mkdir()
    assert screens.kiosk_capable() is False                         # nothing configured
    (d / "sessions.toml").write_text("")                            # empty: no url
    assert screens.kiosk_capable() is False
    (d / "sessions.toml").write_text("url = [")                     # malformed
    assert screens.kiosk_capable() is False
    (d / "homelab.toml").write_text("poll_seconds = 30\n")          # loads, but no hosts
    assert screens.kiosk_capable() is False
    (d / "sessions.toml").write_text('url = "http://192.0.2.10:7781/sessions"\n')
    assert screens.kiosk_capable() is True
