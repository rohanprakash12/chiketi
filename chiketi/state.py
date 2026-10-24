"""Versioned settings persistence.

Settings the control panel changes at runtime (theme, Kiosk theme, devices,
brightness, output, resolution) live here so they survive a restart. A
missing, corrupt, or future-versioned file always degrades to DEFAULT_STATE:
persistence is a convenience and must never be able to stop the dashboard
booting.

Precedence, resolved by the caller: CLI flag > saved state > built-in default.
"""

from __future__ import annotations

import contextlib
import json
import math
import os
import stat
import tempfile

from chiketi.devices import clean_devices
from chiketi.themes import THEMES

# Themes that have been renamed. Without this an install that had saved
# "Panel/Gold" would fail the membership test below, lose its choice
# silently, and come back on the default.
_THEME_RENAMES = {
    "Panel/Gold": "Sci-Fi/TOS",
    "Panel/Teal": "Sci-Fi/DS9",
    "Panel/Coral": "Sci-Fi/TNG",
}

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
_MAX_KEY_LEN = 64

DEFAULT_STATE: dict = {
    "version": STATE_VERSION,
    "theme": "Sci-Fi/TOS",
    "kiosk_theme": "Sci-Fi/TOS",
    "brightness": 1.0,
    "output": "",
    "width": 1024,
    "height": 600,
    "devices": {},
}


def _defaults() -> dict:
    """A fresh, fully detached copy of DEFAULT_STATE.

    dict(DEFAULT_STATE) would be a *shallow* copy sharing the nested
    screen_rotation dict, so one caller mutating its result would silently
    rewrite everybody else's defaults.
    """
    out = dict(DEFAULT_STATE)
    out["devices"] = {}
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


def _sanitize(raw: dict) -> dict:
    """Coerce a loaded blob into DEFAULT_STATE's shape, dropping anything else.

    Every field is independently validated: one bad key degrades that key to
    its default rather than discarding the whole file.
    """
    out = _defaults()

    theme = raw.get("theme")
    if isinstance(theme, str):
        theme = _THEME_RENAMES.get(theme, theme)
    if isinstance(theme, str) and theme in THEMES:
        out["theme"] = theme

    # The house theme for Kiosk displays. A file from before modes has none: it
    # starts as the house theme if that is a Kiosk theme.
    from chiketi import screens
    kiosk_theme = raw.get("kiosk_theme")
    if isinstance(kiosk_theme, str) and screens.theme_allowed("kiosk", kiosk_theme):
        out["kiosk_theme"] = kiosk_theme
    elif screens.theme_allowed("kiosk", out["theme"]):
        out["kiosk_theme"] = out["theme"]
    else:
        out["kiosk_theme"] = screens.default_theme("kiosk")

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

    out["devices"] = clean_devices(raw.get("devices"))
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
        # Open FIRST, then fstat the descriptor. stat-then-open leaves a
        # window in which the path can be swapped for a FIFO between the two
        # calls, and the open would then block forever. O_NONBLOCK makes even
        # that open return immediately, and fstat describes the object we
        # actually hold rather than whatever the name pointed at a moment ago.
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode):
                return _defaults()
            if st.st_size > _MAX_STATE_BYTES:
                return _defaults()
            with os.fdopen(fd, "rb") as fh:
                fd = None                      # fdopen owns it now
                data = fh.read(_MAX_STATE_BYTES + 1)
        finally:
            if fd is not None:
                os.close(fd)
        if len(data) > _MAX_STATE_BYTES:        # grew between fstat and read
            return _defaults()
        raw = json.loads(data.decode("utf-8", errors="replace"))
        if not isinstance(raw, dict):
            return _defaults()
        # Reject bool too: `{"version": true}` compares equal to 1.
        version = raw.get("version")
        if isinstance(version, bool) or version != STATE_VERSION:
            return _defaults()
        out = _sanitize(raw)
        if _needs_migration(raw):
            # The server backs these exact bytes up before its first write
            # replaces them (server._persist), and saves the migrated file.
            out["migrated"] = True
            out["migration_blob"] = data
        return out
    except Exception:
        return _defaults()


def _needs_migration(raw: dict) -> bool:
    """A file from before screen modes: a house-wide screen_rotation, or a
    device without a mode."""
    devices = raw.get("devices")
    old_device = isinstance(devices, dict) and any(
        isinstance(d, dict) and "mode" not in d for d in devices.values())
    return "screen_rotation" in raw or old_device


def migration_backup(path: str, blob: bytes) -> str | None:
    """Keep the pre-migration file as state.json.bak-YYYYMMDD, once.

    Writes the bytes load_state() actually read (not whatever is at the path
    now), to a temp file that is fsynced and then linked into place, so the
    backup is complete or absent and never overwrites anything. Returns "made",
    "exists" (a regular backup is already there) or None (no usable backup:
    a symlink or other non-file in the way, or a write failure)."""
    import time
    bak = f"{path}.bak-{time.strftime('%Y%m%d')}"

    def existing():
        try:
            return "exists" if stat.S_ISREG(os.lstat(bak).st_mode) else None
        except FileNotFoundError:
            return "missing"
        except OSError:
            return None

    state = existing()
    if state != "missing":
        return state
    tmp = f"{bak}.tmp-{os.getpid()}"
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(blob)
            fh.flush()
            os.fsync(fh.fileno())
        try:
            os.link(tmp, bak)
        except FileExistsError:
            state = existing()
            return state if state != "missing" else None
        return "made"
    except OSError:
        return None
    finally:
        with contextlib.suppress(OSError):
            os.unlink(tmp)


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
            # fsync the DIRECTORY too. Without it the rename can still be in
            # the page cache when power is cut, so a durable file arrives
            # under a name that was never committed - which is exactly the
            # failure mode a Pi kiosk hits on an abrupt power loss.
            try:
                dfd = os.open(directory, os.O_RDONLY)
                try:
                    os.fsync(dfd)
                finally:
                    os.close(dfd)
            except Exception:
                pass          # best effort: some filesystems refuse this
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
