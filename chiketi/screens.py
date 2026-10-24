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
