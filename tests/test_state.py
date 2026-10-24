"""Tests for chiketi.state -- versioned settings persistence.

The contract this file defends: load_state() must be *incapable* of raising,
for any file content whatsoever. Persistence is a convenience; it must never
be able to stop the dashboard booting. Every hostile-input test below is a
real failure mode of the obvious narrow-except implementation.
"""

from __future__ import annotations

import contextlib
import json
import os
import signal
import stat
import threading
from pathlib import Path
from unittest import mock

import pytest

from chiketi.state import (
    DEFAULT_STATE,
    STATE_VERSION,
    load_state,
    save_state,
    state_path,
)


@contextlib.contextmanager
def _time_limit(seconds: float):
    """Fail rather than hang if the code under test blocks."""
    timer = threading.Timer(seconds, lambda: os.kill(os.getpid(), signal.SIGALRM))
    fired = []

    def _boom(signum, frame):
        fired.append(True)
        raise AssertionError(f"blocked for more than {seconds}s")

    old = signal.signal(signal.SIGALRM, _boom)
    timer.start()
    try:
        yield
    finally:
        timer.cancel()
        signal.signal(signal.SIGALRM, old)


def _write(raw: str | bytes) -> Path:
    """Write raw bytes/text to the configured state path."""
    p = Path(state_path())
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(raw, bytes):
        p.write_bytes(raw)
    else:
        p.write_text(raw, encoding="utf-8")
    return p


@pytest.fixture(autouse=True)
def _isolated_config(tmp_path, monkeypatch):
    """Belt-and-braces: never touch the developer's real ~/.config."""
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))


class TestStatePath:
    def test_uses_xdg_config_home(self, tmp_path, monkeypatch):
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        assert state_path() == str(tmp_path / "chiketi" / "state.json")

    def test_falls_back_to_dot_config(self, monkeypatch):
        monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
        monkeypatch.setenv("HOME", "/home/someone")
        assert state_path() == "/home/someone/.config/chiketi/state.json"

    def test_empty_xdg_config_home_falls_back(self, monkeypatch):
        monkeypatch.setenv("XDG_CONFIG_HOME", "")
        monkeypatch.setenv("HOME", "/home/someone")
        assert state_path() == "/home/someone/.config/chiketi/state.json"


class TestLoadDefaults:
    def test_missing_file_returns_defaults(self):
        assert load_state() == DEFAULT_STATE

    def test_corrupt_file_returns_defaults(self):
        _write("{not json")
        assert load_state() == DEFAULT_STATE

    def test_empty_file_returns_defaults(self):
        _write("")
        assert load_state() == DEFAULT_STATE

    def test_unknown_version_returns_defaults(self):
        _write(json.dumps({"version": 999, "theme": "Sci-Fi/DS9"}))
        assert load_state() == DEFAULT_STATE

    def test_missing_version_returns_defaults(self):
        _write(json.dumps({"theme": "Sci-Fi/DS9"}))
        assert load_state() == DEFAULT_STATE

    def test_version_wrong_type_returns_defaults(self):
        _write(json.dumps({"version": "1", "theme": "Sci-Fi/DS9"}))
        assert load_state() == DEFAULT_STATE

    @pytest.mark.parametrize("blob", ["[]", '"hello"', "42", "null", "true"])
    def test_non_object_toplevel_returns_defaults(self, blob):
        _write(blob)
        assert load_state() == DEFAULT_STATE

    def test_result_does_not_alias_default_state(self):
        """Mutating a loaded state must not corrupt DEFAULT_STATE.

        A shallow dict(DEFAULT_STATE) shares the nested devices dict, so one
        caller's mutation would silently become everybody's default.
        """
        s = load_state()
        s["devices"]["injected"] = {"name": "x"}
        s["theme"] = "Vintage/VFD"
        assert DEFAULT_STATE["devices"] == {}
        assert DEFAULT_STATE["theme"] == "Sci-Fi/TOS"
        assert load_state() == DEFAULT_STATE


class TestLoadHostileContent:
    """load_state() must never raise, whatever is on disk."""

    def test_deeply_nested_json_recursion_error(self):
        # json.loads raises RecursionError here -- which subclasses
        # RuntimeError, NOT ValueError. A narrow `except (OSError, ValueError)`
        # lets it escape and kills startup.
        _write("[" * 60000 + "]" * 60000)
        assert load_state() == DEFAULT_STATE

    def test_invalid_utf8_bytes(self):
        # UnicodeDecodeError is raised by the read inside json.load.
        _write(b'\xff\xfe\x00{"version": 1}')
        assert load_state() == DEFAULT_STATE

    def test_nul_bytes_in_file(self):
        _write(b'{"version": 1, "theme": "Panel\x00/Teal"}')
        assert load_state() == DEFAULT_STATE

    def test_huge_integer_brightness(self):
        # float() of a 4000-digit int raises OverflowError, which does NOT
        # subclass ValueError.
        _write('{"version": 1, "brightness": ' + "9" * 4000 + "}")
        assert load_state()["brightness"] == DEFAULT_STATE["brightness"]

    def test_huge_integer_width(self):
        _write('{"version": 1, "width": ' + "9" * 4000 + "}")
        assert load_state()["width"] == DEFAULT_STATE["width"]

    def test_json_infinity_brightness(self):
        # Python's json accepts the non-standard Infinity/NaN literals.
        _write('{"version": 1, "brightness": Infinity}')
        b = load_state()["brightness"]
        assert 0.3 <= b <= 2.0

    def test_json_nan_brightness(self):
        _write('{"version": 1, "brightness": NaN}')
        b = load_state()["brightness"]
        assert 0.3 <= b <= 2.0
        assert b == b  # not NaN

    def test_directory_instead_of_file(self):
        p = Path(state_path())
        p.mkdir(parents=True, exist_ok=True)
        assert load_state() == DEFAULT_STATE

    def test_dangling_symlink(self, tmp_path):
        p = Path(state_path())
        p.parent.mkdir(parents=True, exist_ok=True)
        os.symlink(str(tmp_path / "does-not-exist"), str(p))
        assert load_state() == DEFAULT_STATE

    @pytest.mark.skipif(os.geteuid() == 0, reason="root ignores file permissions")
    def test_unreadable_file(self):
        p = _write(json.dumps({"version": STATE_VERSION}))
        os.chmod(p, 0o000)
        try:
            assert load_state() == DEFAULT_STATE
        finally:
            os.chmod(p, stat.S_IRUSR | stat.S_IWUSR)

    def test_arbitrary_exception_from_open(self):
        """Even an exception nobody predicted must degrade to defaults."""
        with mock.patch("builtins.open", side_effect=RecursionError("boom")):
            assert load_state() == DEFAULT_STATE
        with mock.patch("builtins.open", side_effect=MemoryError("boom")):
            assert load_state() == DEFAULT_STATE

    def test_state_path_failure_degrades(self):
        with mock.patch("chiketi.state.state_path", side_effect=RuntimeError):
            assert load_state() == DEFAULT_STATE

    def test_keyboard_interrupt_is_not_swallowed(self):
        """Broad, but not so broad it eats Ctrl-C.

        A real file must exist: load_state() now stats the path first and
        returns defaults for anything that is not a regular file, so with no
        file present open() is never reached and the mock never fires.
        """
        _write(json.dumps({"version": 1, "theme": "Sci-Fi/DS9"}))
        # load_state now uses os.open + os.fdopen so it can fstat the
        # descriptor rather than stat the path, so patch that call.
        with mock.patch("os.open", side_effect=KeyboardInterrupt):
            with pytest.raises(KeyboardInterrupt):
                load_state()

    def test_non_regular_file_returns_defaults_without_blocking(self, tmp_path):
        """A FIFO blocks forever in open(); /dev/zero blocks inside the parse.

        A hang on the boot path is not catchable, so it is strictly worse than
        any exception -- the guard has to be a stat(), not a try/except.
        """
        p = Path(state_path())
        p.parent.mkdir(parents=True, exist_ok=True)
        os.mkfifo(p)
        try:
            with _time_limit(8):
                assert load_state() == DEFAULT_STATE
        finally:
            p.unlink()

    def test_oversized_file_returns_defaults(self):
        _write('{"version": 1, "theme": "Vintage/VFD", "pad": "'
               + "x" * (2 * 1024 * 1024) + '"}')
        assert load_state() == DEFAULT_STATE


class TestSanitize:
    def test_unknown_keys_dropped(self):
        _write(json.dumps({"version": 1, "theme": "Sci-Fi/DS9", "evil": 1}))
        loaded = load_state()
        assert "evil" not in loaded
        assert set(loaded) == set(DEFAULT_STATE)

    def test_invalid_theme_falls_back(self):
        _write(json.dumps({"version": 1, "theme": "Nope/Nope"}))
        assert load_state()["theme"] == DEFAULT_STATE["theme"]

    def test_valid_theme_kept(self):
        _write(json.dumps({"version": 1, "theme": "Vintage/VFD"}))
        assert load_state()["theme"] == "Vintage/VFD"

    @pytest.mark.parametrize("bad", [None, 5, [], {}, True])
    def test_non_string_theme_falls_back(self, bad):
        _write(json.dumps({"version": 1, "theme": bad}))
        assert load_state()["theme"] == DEFAULT_STATE["theme"]

    def test_brightness_clamped(self):
        _write(json.dumps({"version": 1, "brightness": 99}))
        assert load_state()["brightness"] == 2.0
        _write(json.dumps({"version": 1, "brightness": -3}))
        assert load_state()["brightness"] == 0.3

    def test_brightness_non_numeric_falls_back(self):
        _write(json.dumps({"version": 1, "brightness": "bright"}))
        assert load_state()["brightness"] == DEFAULT_STATE["brightness"]

    def test_dimensions_clamped(self):
        _write(json.dumps({"version": 1, "width": 99999, "height": 1}))
        loaded = load_state()
        assert loaded["width"] == 3840
        assert loaded["height"] == 200

    def test_dimensions_non_int_falls_back(self):
        _write(json.dumps({"version": 1, "width": "wide", "height": 4.5}))
        loaded = load_state()
        assert loaded["width"] == DEFAULT_STATE["width"]
        assert loaded["height"] == DEFAULT_STATE["height"]

    def test_boolean_dimensions_rejected(self):
        # bool is a subclass of int; True must not silently become width=320.
        _write(json.dumps({"version": 1, "width": True}))
        assert load_state()["width"] == DEFAULT_STATE["width"]

    def test_output_kept(self):
        _write(json.dumps({"version": 1, "output": "HDMI-1"}))
        assert load_state()["output"] == "HDMI-1"

    def test_overlong_output_rejected(self):
        _write(json.dumps({"version": 1, "output": "x" * 65}))
        assert load_state()["output"] == ""

    def test_non_string_output_rejected(self):
        _write(json.dumps({"version": 1, "output": 12}))
        assert load_state()["output"] == ""

class TestSave:
    def test_roundtrip(self):
        s = dict(DEFAULT_STATE, theme="Vintage/VFD", brightness=1.4)
        assert save_state(s) is True
        loaded = load_state()
        assert loaded["theme"] == "Vintage/VFD"
        assert loaded["brightness"] == 1.4

    def test_roundtrip_output_and_size(self):
        s = dict(DEFAULT_STATE, output="HDMI-1", width=800, height=480)
        assert save_state(s) is True
        loaded = load_state()
        assert loaded["output"] == "HDMI-1"
        assert (loaded["width"], loaded["height"]) == (800, 480)

    def test_creates_parent_directory(self):
        assert not Path(state_path()).parent.exists()
        assert save_state(dict(DEFAULT_STATE)) is True
        assert Path(state_path()).is_file()

    def test_writes_current_version(self):
        save_state(dict(DEFAULT_STATE, version=999))
        on_disk = json.loads(Path(state_path()).read_text(encoding="utf-8"))
        assert on_disk["version"] == STATE_VERSION

    def test_unknown_keys_not_written(self):
        save_state(dict(DEFAULT_STATE, secret="hunter2"))
        on_disk = json.loads(Path(state_path()).read_text(encoding="utf-8"))
        assert "secret" not in on_disk

    def test_save_is_atomic(self):
        """A failed write must not leave a truncated file behind."""
        save_state(dict(DEFAULT_STATE, theme="Sci-Fi/DS9"))
        with mock.patch("json.dump", side_effect=OSError("disk full")):
            assert save_state(dict(DEFAULT_STATE, theme="Vintage/VFD")) is False
        assert load_state()["theme"] == "Sci-Fi/DS9"

    def test_failed_save_leaves_no_temp_files(self):
        save_state(dict(DEFAULT_STATE))
        with mock.patch("json.dump", side_effect=OSError("disk full")):
            save_state(dict(DEFAULT_STATE, theme="Vintage/VFD"))
        leftovers = [p.name for p in Path(state_path()).parent.iterdir()
                     if p.name != "state.json"]
        assert leftovers == []

    def test_save_never_raises_on_bad_input(self):
        for bad in (None, 5, "string", [1, 2, 3]):
            assert save_state(bad) is False

    @pytest.mark.skipif(os.geteuid() == 0, reason="root ignores file permissions")
    def test_readonly_home_returns_false(self, tmp_path, monkeypatch):
        ro = tmp_path / "readonly"
        ro.mkdir()
        os.chmod(ro, stat.S_IRUSR | stat.S_IXUSR)
        monkeypatch.setenv("XDG_CONFIG_HOME", str(ro))
        try:
            assert save_state(dict(DEFAULT_STATE)) is False
        finally:
            os.chmod(ro, stat.S_IRWXU)

    def test_save_never_raises_on_arbitrary_failure(self):
        with mock.patch("os.replace", side_effect=RecursionError("boom")):
            assert save_state(dict(DEFAULT_STATE)) is False
        with mock.patch("tempfile.mkstemp", side_effect=MemoryError("boom")):
            assert save_state(dict(DEFAULT_STATE)) is False

    def test_save_does_not_swallow_keyboard_interrupt(self):
        with mock.patch("os.replace", side_effect=KeyboardInterrupt):
            with pytest.raises(KeyboardInterrupt):
                save_state(dict(DEFAULT_STATE))


class TestThemeRenameMigration:
    """A saved theme whose name has since changed must survive the upgrade.

    _sanitize drops any theme not in THEMES, so without the rename map an
    install that had chosen Panel/Gold would come back on the default with no
    sign that anything had happened.
    """

    def test_old_panel_names_migrate(self):
        for old, new in (
            ("Panel/Gold", "Sci-Fi/TOS"),
            ("Panel/Teal", "Sci-Fi/DS9"),
            ("Panel/Coral", "Sci-Fi/TNG"),
        ):
            _write(json.dumps({"version": STATE_VERSION, "theme": old}))
            assert load_state()["theme"] == new

    def test_a_name_that_never_existed_still_falls_back(self):
        _write(json.dumps({"version": STATE_VERSION, "theme": "Panel/Nonexistent"}))
        assert load_state()["theme"] == DEFAULT_STATE["theme"]


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


# ── Screen modes: kiosk_theme, no screen_rotation, the migration ──────────

def test_kiosk_theme_and_no_screen_rotation():
    p = _write(json.dumps({"version": 1, "theme": "Others/Claude",
                           "screen_rotation": {"screen6": {"enabled": False, "duration": 10}}}))
    s = load_state()
    assert "screen_rotation" not in s and s["kiosk_theme"] == "Others/Claude"
    p.write_text(json.dumps({"version": 1, "theme": "Terminal/hacker"}))
    assert load_state()["kiosk_theme"] == "Sci-Fi/TOS"
    p.write_text(json.dumps({"version": 1, "theme": "Terminal/hacker", "kiosk_theme": "Others/Claude"}))
    assert load_state()["kiosk_theme"] == "Others/Claude"
    p.write_text(json.dumps({"version": 1, "kiosk_theme": "Terminal/hacker"}))
    assert load_state()["kiosk_theme"] == "Sci-Fi/TOS"


def test_old_file_is_marked_for_migration_with_its_bytes():
    old = json.dumps({"version": 1, "devices": {"go": {"name": "Go", "caps": {}}}})
    _write(old)
    s = load_state()
    assert s["migrated"] is True and s["migration_blob"] == old.encode()
    _write(json.dumps({"version": 1, "screen_rotation": {}}))
    assert load_state()["migrated"] is True
    _write(json.dumps({"version": 1, "devices": {"go": {"name": "Go", "mode": "kiosk", "caps": {}}}}))
    s = load_state()
    assert "migrated" not in s and "migration_blob" not in s


def test_migrated_state_round_trips():
    _write(json.dumps({"version": 1, "theme": "Others/Claude", "brightness": 1.3, "output": "HDMI-1",
                       "width": 800, "height": 480, "screen_rotation": {"screen6": {"enabled": False}},
                       "devices": {"go": {"name": "Go", "mode": "kiosk", "screens": ["sessions"], "caps": {}}}}))
    first = load_state()
    assert save_state(first) is True
    on_disk = json.loads(Path(state_path()).read_text(encoding="utf-8"))
    assert "migrated" not in on_disk and "migration_blob" not in on_disk and "screen_rotation" not in on_disk
    again = load_state()
    for key in ("theme", "kiosk_theme", "brightness", "output", "width", "height"):
        assert again[key] == first[key], key
    assert again["devices"]["go"]["mode"] == "kiosk" and again["devices"]["go"]["screens"] == ["sessions"]


class TestMigrationBackup:
    def _bak(self):
        import time
        return state_path() + ".bak-" + time.strftime("%Y%m%d")

    def test_made_once_from_the_bytes_read(self):
        from chiketi.state import migration_backup
        p = _write("old bytes")
        assert migration_backup(str(p), b"what was read") == "made"
        p.write_text("replaced since")
        assert Path(self._bak()).read_bytes() == b"what was read"
        assert migration_backup(str(p), b"other") == "exists"
        assert Path(self._bak()).read_bytes() == b"what was read"
        assert not list(p.parent.glob("*.tmp-*"))

    def test_symlink_at_backup_path_is_left_alone(self, tmp_path):
        from chiketi.state import migration_backup
        p = _write("old")
        target = tmp_path / "elsewhere"
        target.write_text("untouched")
        os.symlink(target, self._bak())
        assert migration_backup(str(p), b"x") is None
        assert target.read_text() == "untouched" and os.path.islink(self._bak())
        os.unlink(self._bak())
        os.symlink(tmp_path / "missing", self._bak())                     # dangling
        assert migration_backup(str(p), b"x") is None
        assert not (tmp_path / "missing").exists()

    def test_failed_write_leaves_nothing(self, monkeypatch):
        from chiketi import state
        p = _write("old")

        def boom(fd):
            raise OSError("disk full")
        monkeypatch.setattr(state.os, "fsync", boom)
        assert state.migration_backup(str(p), b"x") is None
        assert not os.path.lexists(self._bak()) and not list(p.parent.glob("*.tmp-*"))
