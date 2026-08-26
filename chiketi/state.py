"""Versioned settings persistence.

Settings the control panel changes at runtime (theme, per-screen rotation,
brightness, output, resolution) live here so they survive a restart. A
missing, corrupt, or future-versioned file always degrades to DEFAULT_STATE:
persistence is a convenience and must never be able to stop the dashboard
booting.

Precedence, resolved by the caller: CLI flag > saved state > built-in default.
"""

from __future__ import annotations

import json
import math
import os
import stat
import tempfile

from chiketi.themes import THEMES

STATE_VERSION = 1

# The state file is a few hundred bytes. Cap the read so a huge (or endless)
# file cannot be slurped into memory.
_MAX_STATE_BYTES = 1024 * 1024

# Bounds mirror the clamps the control API already applies (server.py) so a
# hand-edited file can never push the running server outside them.
_BRIGHTNESS_MIN = 0.3
_BRIGHTNESS_MAX = 2.0
_WIDTH_MIN, _WIDTH_MAX = 320, 3840
_HEIGHT_MIN, _HEIGHT_MAX = 200, 2160
_DURATION_MIN, _DURATION_MAX = 3, 600
_MAX_SCREEN_ROTATION = 32
_MAX_KEY_LEN = 64

DEFAULT_STATE: dict = {
    "version": STATE_VERSION,
    "theme": "Panel/Gold",
    "screen_rotation": {},
    "brightness": 1.0,
    "output": "",
    "width": 1024,
    "height": 600,
}


def _defaults() -> dict:
    """A fresh, fully detached copy of DEFAULT_STATE.

    dict(DEFAULT_STATE) would be a *shallow* copy sharing the nested
    screen_rotation dict, so one caller mutating its result would silently
    rewrite everybody else's defaults.
    """
    out = dict(DEFAULT_STATE)
    out["screen_rotation"] = {}
    return out


def state_path() -> str:
    """Absolute path of the state file (not guaranteed to exist)."""
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return os.path.join(base, "chiketi", "state.json")


def _clamp_number(value, lo: float, hi: float):
    """Clamp a JSON number, or return None if it is not a usable finite one.

    Deliberately broad: json accepts arbitrary-precision ints, so float() of a
    4000-digit literal raises OverflowError -- which does NOT subclass
    ValueError -- and json also accepts the non-standard NaN/Infinity literals,
    which sail straight through min()/max() as silent garbage.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        num = float(value)
    except Exception:
        return None
    if not math.isfinite(num):
        return None
    return max(lo, min(hi, num))


def _clean_rotation(raw) -> dict:
    """Coerce a screen_rotation blob into {sid: {enabled, duration}}."""
    if not isinstance(raw, dict):
        return {}
    clean: dict = {}
    for sid, cfg in list(raw.items())[:_MAX_SCREEN_ROTATION]:
        if not isinstance(sid, str) or len(sid) > _MAX_KEY_LEN:
            continue
        if not isinstance(cfg, dict):
            continue
        try:
            duration = int(cfg.get("duration", 10))
        except Exception:
            # Broad on purpose: int() raises TypeError/ValueError on the
            # obvious junk, but OverflowError on float('inf') (reachable via
            # the JSON literal `Infinity`) -- and that is neither.
            continue
        clean[sid] = {
            "enabled": bool(cfg.get("enabled", True)),
            "duration": max(_DURATION_MIN, min(_DURATION_MAX, duration)),
        }
    return clean


def _sanitize(raw: dict) -> dict:
    """Coerce a loaded blob into DEFAULT_STATE's shape, dropping anything else.

    Every field is independently validated: one bad key degrades that key to
    its default rather than discarding the whole file.
    """
    out = _defaults()

    theme = raw.get("theme")
    if isinstance(theme, str) and theme in THEMES:
        out["theme"] = theme

    brightness = _clamp_number(raw.get("brightness"), _BRIGHTNESS_MIN, _BRIGHTNESS_MAX)
    if brightness is not None:
        out["brightness"] = brightness

    for key, lo, hi in (
        ("width", _WIDTH_MIN, _WIDTH_MAX),
        ("height", _HEIGHT_MIN, _HEIGHT_MAX),
    ):
        value = raw.get(key)
        if isinstance(value, bool) or not isinstance(value, int):
            continue
        clamped = _clamp_number(value, lo, hi)
        if clamped is not None:
            out[key] = int(clamped)

    output = raw.get("output")
    if isinstance(output, str) and len(output) <= _MAX_KEY_LEN:
        out["output"] = output

    out["screen_rotation"] = _clean_rotation(raw.get("screen_rotation"))
    return out


def load_state() -> dict:
    """Return the saved state, or DEFAULT_STATE. Never raises.

    The whole body is guarded because the file is arbitrary bytes an operator
    (or anything else with write access to ~/.config) may have put there:
      * deeply nested JSON  -> RecursionError (a RuntimeError, not ValueError)
      * a 4000-digit number -> OverflowError from float()/int()
      * invalid UTF-8       -> UnicodeDecodeError raised by json.load's read,
                               i.e. from inside the context manager
      * a directory, a dangling symlink, a bad mode -> OSError
      * a NUL in the path, a huge file -> ValueError / MemoryError
    Only BaseException-but-not-Exception (KeyboardInterrupt, SystemExit)
    propagates, so Ctrl-C during startup still works.
    """
    try:
        path = state_path()
        # Guard against BLOCKING, not just raising. A FIFO here blocks forever
        # in open(); a symlink to /dev/zero or /dev/full blocks forever inside
        # json.load. Both hang the boot path, and a hang is not catchable --
        # strictly worse than any exception. Only a regular file is read, and
        # only up to a cap, which also bounds the memory a huge file can take.
        st = os.stat(path)                      # follows symlinks, as open does
        if not stat.S_ISREG(st.st_mode):
            return _defaults()
        if st.st_size > _MAX_STATE_BYTES:
            return _defaults()
        with open(path, encoding="utf-8") as fh:
            blob = fh.read(_MAX_STATE_BYTES + 1)
        if len(blob) > _MAX_STATE_BYTES:        # grew between stat and read
            return _defaults()
        raw = json.loads(blob)
        if not isinstance(raw, dict):
            return _defaults()
        # Reject bool too: `{"version": true}` compares equal to 1.
        version = raw.get("version")
        if isinstance(version, bool) or version != STATE_VERSION:
            return _defaults()
        return _sanitize(raw)
    except Exception:
        return _defaults()


def save_state(state: dict) -> bool:
    """Atomically persist state. Returns False on any failure; never raises.

    Callers treat this as best-effort: a read-only or full HOME is a supported
    situation and must never fail an HTTP request or startup.
    """
    if not isinstance(state, dict):
        # Refuse rather than write defaults over a perfectly good file.
        return False
    try:
        path = state_path()
        directory = os.path.dirname(path)
        os.makedirs(directory, exist_ok=True)
        payload = _sanitize(state)
        payload["version"] = STATE_VERSION
        # Temp file in the *same* directory so os.replace stays a same-
        # filesystem rename, which is atomic: a crash or a full disk leaves
        # either the old complete file or the new one, never a truncated one.
        fd, tmp = tempfile.mkstemp(dir=directory, suffix=".tmp", prefix="state-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
                fh.flush()
                os.fsync(fh.fileno())  # durable before the rename, not after
            os.replace(tmp, path)
            return True
        except Exception:
            # Broad: anything from the write path (OSError, RecursionError,
            # MemoryError, a mocked failure) must leave no debris behind.
            try:
                os.unlink(tmp)
            except OSError:
                pass
            return False
    except Exception:
        return False
