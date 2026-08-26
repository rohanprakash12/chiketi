"""Tests for MetricEngine, DisplayManager, and session-env detection.

Fully headless: no display, GPU, network, real xrandr or Chromium is touched.
Every subprocess / filesystem probe is mocked at the call site.
"""

from __future__ import annotations

import subprocess
import threading
import time
from unittest import mock

import chiketi.app as app_mod
from chiketi.app import DisplayManager, MetricEngine
from chiketi.collectors.base import MetricValue
from chiketi.config import Timing


def make_manager(**overrides) -> DisplayManager:
    """Build a DisplayManager without running any environment probing.

    DisplayManager.__init__ shells out to loginctl/xrandr/pgrep and reads
    /proc, none of which a headless test may do. __new__ plus explicit
    attributes gives the same object with none of the probing.
    """
    mgr = DisplayManager.__new__(DisplayManager)
    mgr._url = "http://localhost:7777/display"
    mgr._chromium = "/usr/bin/chromium"
    mgr._wayland = False
    mgr._session_env = {}
    mgr._display_env = ":0"
    mgr._screen_size = None
    mgr._proc = None
    mgr._adopted_pid = None
    mgr._lock = threading.Lock()
    mgr._x_vt = None
    for key, value in overrides.items():
        setattr(mgr, key, value)
    return mgr


class TestChromiumProfile:
    def test_launch_uses_dedicated_profile(self, tmp_path, monkeypatch):
        monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
        mgr = make_manager()
        with mock.patch("subprocess.Popen") as popen:
            popen.return_value.pid = 4242
            popen.return_value.poll.return_value = None
            assert mgr.turn_on() is True
        args = popen.call_args[0][0]
        assert any(a.startswith("--user-data-dir=") for a in args), args

    def test_profile_lives_under_xdg_state_home(self, tmp_path, monkeypatch):
        monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
        path = app_mod._profile_dir()
        assert path == str(tmp_path / "chiketi" / "chromium-profile")
        assert (tmp_path / "chiketi" / "chromium-profile").is_dir()

    def test_unwritable_profile_dir_does_not_break_launch(self, tmp_path, monkeypatch):
        """A read-only HOME must degrade, not raise out of turn_on()."""
        monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
        mgr = make_manager()
        with mock.patch("os.makedirs", side_effect=PermissionError("read-only")), \
             mock.patch("subprocess.Popen") as popen:
            popen.return_value.pid = 4242
            popen.return_value.poll.return_value = None
            assert mgr.turn_on() is True
        args = popen.call_args[0][0]
        assert not any(a.startswith("--user-data-dir=") for a in args), args

    def test_adoption_still_matches_with_profile_flag(self, tmp_path, monkeypatch):
        """--user-data-dir must not break _adopt_existing's pgrep matching."""
        monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
        mgr = make_manager()
        with mock.patch("subprocess.Popen") as popen:
            popen.return_value.pid = 4242
            popen.return_value.poll.return_value = None
            mgr.turn_on()
        launched = " ".join(popen.call_args[0][0])

        # Rebuild a manager and let _adopt_existing see that exact command
        # line, the way `pgrep -a -f kiosk` would report it.
        fresh = make_manager(_adopted_pid=None)
        pgrep_out = mock.Mock(stdout=f"4242 {launched}\n")
        with mock.patch("subprocess.run", return_value=pgrep_out), \
             mock.patch("os.kill", return_value=None):
            fresh._adopt_existing()
        assert fresh._adopted_pid == 4242


def loginctl_stub(sessions, leaders):
    """Build a subprocess.run stub that answers loginctl queries.

    `sessions` maps session id -> property dict (Type/User/Display/Name),
    `leaders` maps session id -> leader pid string.
    Anything that is not loginctl returns empty output.
    """

    def _run(cmd, *args, **kwargs):
        if not cmd or cmd[0] != "loginctl":
            return mock.Mock(stdout="", stderr="", returncode=0)
        if cmd[1] == "list-sessions":
            lines = [f"{sid} 1000 rohan seat0" for sid in sessions]
            return mock.Mock(stdout="\n".join(lines) + "\n", returncode=0)
        sid = cmd[2]
        if "--property=Leader" in cmd:
            return mock.Mock(stdout=f"Leader={leaders.get(sid, '')}\n", returncode=0)
        props = sessions.get(sid, {})
        body = "".join(f"{k}={v}\n" for k, v in props.items())
        return mock.Mock(stdout=body, returncode=0)

    return _run


class TestGraphicalSessionUid:
    def test_ignores_sessions_owned_by_other_users(self, monkeypatch):
        monkeypatch.setattr(app_mod.os, "getuid", lambda: 1000)
        # Ours first, the stranger's second: a plain env.update() would let
        # the foreign session overwrite everything we just found.
        sessions = {
            "c1": {"Type": "x11", "User": "1000", "Name": "rohan"},
            "c2": {"Type": "x11", "User": "1001", "Name": "someone"},
        }
        leaders = {"c1": "111", "c2": "222"}
        env_by_pid = {
            111: {"DISPLAY": ":1", "XAUTHORITY": "/home/rohan/.Xauthority"},
            222: {"DISPLAY": ":9", "XAUTHORITY": "/home/someone/.Xauthority"},
        }
        with mock.patch.object(app_mod.subprocess, "run",
                               side_effect=loginctl_stub(sessions, leaders)), \
             mock.patch.object(app_mod, "_read_env_from_proc",
                               side_effect=lambda pid: dict(env_by_pid[pid])), \
             mock.patch.object(app_mod.glob, "glob", return_value=[]):
            env = app_mod._get_graphical_session_env()
        assert env == {"DISPLAY": ":1", "XAUTHORITY": "/home/rohan/.Xauthority"}

    def test_does_not_blend_variables_across_sessions(self, monkeypatch):
        """One session's DISPLAY must never be paired with another's XAUTHORITY."""
        monkeypatch.setattr(app_mod.os, "getuid", lambda: 1000)
        sessions = {
            "c1": {"Type": "x11", "User": "1000", "Name": "rohan"},
            "c2": {"Type": "wayland", "User": "1000", "Name": "rohan"},
        }
        leaders = {"c1": "111", "c2": "222"}
        env_by_pid = {
            111: {"DISPLAY": ":1"},
            222: {"WAYLAND_DISPLAY": "wayland-0",
                  "XAUTHORITY": "/run/user/1000/.mutter-Xwaylandauth"},
        }
        with mock.patch.object(app_mod.subprocess, "run",
                               side_effect=loginctl_stub(sessions, leaders)), \
             mock.patch.object(app_mod, "_read_env_from_proc",
                               side_effect=lambda pid: dict(env_by_pid[pid])), \
             mock.patch.object(app_mod.glob, "glob", return_value=[]):
            env = app_mod._get_graphical_session_env()
        # Exactly one session's variables, never the union of both.
        assert env in ({"DISPLAY": ":1"}, env_by_pid[222])
        assert not ("DISPLAY" in env and "XAUTHORITY" in env and
                    env.get("XAUTHORITY", "").endswith("Xwaylandauth")
                    and env.get("DISPLAY") == ":1")

    def test_skips_non_graphical_sessions(self, monkeypatch):
        monkeypatch.setattr(app_mod.os, "getuid", lambda: 1000)
        sessions = {"c1": {"Type": "tty", "User": "1000", "Name": "rohan"}}
        with mock.patch.object(app_mod.subprocess, "run",
                               side_effect=loginctl_stub(sessions, {"c1": "111"})), \
             mock.patch.object(app_mod, "_read_env_from_proc",
                               return_value={"DISPLAY": ":5"}), \
             mock.patch.object(app_mod.glob, "glob", return_value=[]):
            env = app_mod._get_graphical_session_env()
        assert env == {}

    def test_proc_scan_still_wins_when_it_has_xauthority(self, monkeypatch, tmp_path):
        """Precedence between loginctl and the /proc scan must not change."""
        monkeypatch.setattr(app_mod.os, "getuid", lambda: 1000)
        sessions = {"c1": {"Type": "x11", "User": "1000", "Name": "rohan"}}
        proc_dir = tmp_path / "4321"
        proc_dir.mkdir()
        (proc_dir / "environ").write_bytes(
            b"DISPLAY=:1\0XAUTHORITY=/home/rohan/.Xauthority\0"
        )
        with mock.patch.object(app_mod.subprocess, "run",
                               side_effect=loginctl_stub(sessions, {"c1": "111"})), \
             mock.patch.object(app_mod, "_read_env_from_proc",
                               return_value={"DISPLAY": ":0"}), \
             mock.patch.object(app_mod.glob, "glob", return_value=[str(proc_dir)]), \
             mock.patch.object(app_mod.os, "stat",
                               return_value=mock.Mock(st_uid=1000)):
            env = app_mod._get_graphical_session_env()
        assert env == {"DISPLAY": ":1", "XAUTHORITY": "/home/rohan/.Xauthority"}


class _FakeCollector:
    """Collector that records when it ran and optionally burns wall time."""

    def __init__(self, duration: float = 0.0) -> None:
        self.duration = duration
        self.stamps: list[float] = []
        self.first = threading.Event()

    def collect(self) -> dict:
        self.stamps.append(time.monotonic())
        self.first.set()
        if self.duration:
            time.sleep(self.duration)
        return {"fake.value": MetricValue(value=1)}


class _BoomCollector:
    def collect(self) -> dict:
        raise RuntimeError("collector exploded")


class TestMetricEngine:
    def _engine(self, monkeypatch, collectors, interval_ms):
        monkeypatch.setattr(app_mod, "TIMING", Timing(collect_interval_ms=interval_ms))
        monkeypatch.setattr(app_mod, "get_collectors", lambda: list(collectors))
        return MetricEngine()

    def test_period_excludes_collection_time(self, monkeypatch):
        """The loop must hold the interval, not interval + collect time."""
        interval_ms, work_s = 200, 0.12
        fake = _FakeCollector(duration=work_s)
        engine = self._engine(monkeypatch, [fake], interval_ms)
        engine.start()
        try:
            time.sleep(1.0)
        finally:
            engine.stop()
            engine.join(timeout=2)
        assert not engine.is_alive()
        assert len(fake.stamps) >= 3, fake.stamps
        gaps = [b - a for a, b in zip(fake.stamps, fake.stamps[1:])]
        avg = sum(gaps) / len(gaps)
        # Old behaviour slept a full interval *after* collecting: 0.32s.
        # New behaviour sleeps the remainder: ~0.20s.
        assert avg < 0.28, f"period {avg:.3f}s looks like interval+collect"
        assert avg > 0.15, f"period {avg:.3f}s is shorter than the interval"

    def test_stop_returns_promptly(self, monkeypatch):
        fake = _FakeCollector()
        engine = self._engine(monkeypatch, [fake], 60_000)  # 60s interval
        engine.start()
        assert fake.first.wait(timeout=5)
        time.sleep(0.05)
        started = time.monotonic()
        engine.stop()
        engine.join(timeout=5)
        elapsed = time.monotonic() - started
        assert not engine.is_alive()
        assert elapsed < 0.2, f"stop() took {elapsed:.3f}s"

    def test_collector_exception_does_not_kill_the_loop(self, monkeypatch, capsys):
        fake = _FakeCollector()
        engine = self._engine(monkeypatch, [_BoomCollector(), fake], 50)
        engine.start()
        try:
            assert fake.first.wait(timeout=5)
            time.sleep(0.2)
        finally:
            engine.stop()
            engine.join(timeout=2)
        assert not engine.is_alive()
        assert len(fake.stamps) >= 2
        assert engine.get_latest()["fake.value"].value == 1
        assert "_BoomCollector failed" in capsys.readouterr().err

    def test_slow_collector_does_not_busy_spin(self, monkeypatch):
        """Collection slower than the interval must still yield, not spin."""
        fake = _FakeCollector(duration=0.1)
        engine = self._engine(monkeypatch, [fake], 20)  # interval < collect time
        engine.start()
        try:
            time.sleep(0.5)
        finally:
            engine.stop()
            engine.join(timeout=2)
        assert not engine.is_alive()
        # Bounded by collection time, not by an unbounded spin.
        assert len(fake.stamps) <= 8, len(fake.stamps)


class TestDetectDisplayGuards:
    """_detect_display must survive anything /tmp/.X*-lock throws at it."""

    def _no_session(self, monkeypatch):
        monkeypatch.delenv("DISPLAY", raising=False)
        monkeypatch.setattr(app_mod, "_get_graphical_session_env", lambda: {})

    def test_unreadable_lock_file_does_not_propagate(self, monkeypatch):
        """A root-owned /tmp/.X0-lock must not abort DisplayManager startup."""
        self._no_session(monkeypatch)
        monkeypatch.setattr(app_mod.glob, "glob", lambda pat: ["/tmp/.X0-lock"])
        with mock.patch("builtins.open", side_effect=PermissionError("denied")):
            assert app_mod._detect_display() == ":0"

    def test_lock_that_vanished_is_skipped(self, monkeypatch):
        """glob-then-open is a race; a deleted lock must not lose the next one."""
        self._no_session(monkeypatch)
        monkeypatch.setattr(
            app_mod.glob, "glob", lambda pat: ["/tmp/.X0-lock", "/tmp/.X1-lock"]
        )
        real_open = open

        def fake_open(path, *args, **kwargs):
            if path == "/tmp/.X0-lock":
                raise FileNotFoundError(path)
            return mock.mock_open(read_data="4321\n")(path, *args, **kwargs)

        monkeypatch.setattr(app_mod.os.path, "isdir", lambda p: p == "/proc/4321")
        with mock.patch("builtins.open", side_effect=fake_open):
            assert app_mod._detect_display() == ":1"
        assert real_open is open

    def test_display_manager_startup_survives_unreadable_lock(self, monkeypatch):
        """The real blast radius: DisplayManager.__init__ must not raise."""
        self._no_session(monkeypatch)
        monkeypatch.setattr(app_mod.glob, "glob", lambda pat: ["/tmp/.X0-lock"])
        monkeypatch.setattr(app_mod, "_find_chromium", lambda: None)
        monkeypatch.setattr(app_mod, "_is_wayland", lambda: False)
        monkeypatch.setattr(
            DisplayManager, "_detect_screen_size", lambda self: None
        )
        monkeypatch.setattr(DisplayManager, "_detect_x_vt", lambda self: None)
        monkeypatch.setattr(DisplayManager, "_adopt_existing", lambda self: None)
        with mock.patch("builtins.open", side_effect=PermissionError("denied")):
            mgr = DisplayManager("http://localhost:7777/display")
        assert mgr._display_env == ":0"


class TestProcScanGuards:
    def test_unexpected_oserror_skips_one_entry_not_the_scan(self, monkeypatch):
        """An EIO on one /proc entry must not abandon the remaining ones."""
        monkeypatch.setattr(app_mod.os, "getuid", lambda: 1000)
        monkeypatch.setattr(app_mod.subprocess, "run",
                            mock.Mock(side_effect=FileNotFoundError("no loginctl")))
        monkeypatch.setattr(app_mod.glob, "glob",
                            lambda pat: ["/proc/111", "/proc/222"])

        def fake_stat(path, *a, **kw):
            if path == "/proc/111":
                raise OSError(5, "Input/output error")
            return mock.Mock(st_uid=1000)

        monkeypatch.setattr(app_mod.os, "stat", fake_stat)
        data = b"DISPLAY=:1\0XAUTHORITY=/home/rohan/.Xauthority\0"
        with mock.patch("builtins.open", mock.mock_open(read_data=data)):
            env = app_mod._get_graphical_session_env()
        assert env == {"DISPLAY": ":1", "XAUTHORITY": "/home/rohan/.Xauthority"}


class TestAdoptExisting:
    def test_stale_pid_does_not_stop_the_scan(self):
        """pgrep can list a pid that exits before os.kill; keep scanning."""
        mgr = make_manager()
        url = mgr._url
        out = (f"111 /usr/bin/chromium --kiosk --app={url} --user-data-dir=/x\n"
               f"222 /usr/bin/chromium --kiosk --app={url} --user-data-dir=/x\n")
        kills = []

        def fake_kill(pid, sig):
            kills.append(pid)
            if pid == 111:
                raise ProcessLookupError(pid)

        with mock.patch.object(app_mod.subprocess, "run",
                               return_value=mock.Mock(stdout=out)), \
             mock.patch.object(app_mod.os, "kill", side_effect=fake_kill):
            mgr._adopt_existing()
        assert kills == [111, 222]
        assert mgr._adopted_pid == 222

    def test_malformed_pgrep_line_does_not_stop_the_scan(self):
        mgr = make_manager()
        url = mgr._url
        out = (f"notapid --kiosk --app={url}\n"
               f"333 /usr/bin/chromium --kiosk --app={url}\n")
        with mock.patch.object(app_mod.subprocess, "run",
                               return_value=mock.Mock(stdout=out)), \
             mock.patch.object(app_mod.os, "kill", return_value=None):
            mgr._adopt_existing()
        assert mgr._adopted_pid == 333


class TestTurnOffGuards:
    def _proc(self, **kw):
        proc = mock.Mock()
        proc.poll.return_value = None
        for k, v in kw.items():
            setattr(proc, k, v)
        return proc

    def test_terminate_oserror_does_not_propagate(self):
        """turn_off() runs inside the SIGTERM handler; it must never raise."""
        proc = self._proc(terminate=mock.Mock(side_effect=PermissionError("nope")))
        mgr = make_manager(_proc=proc)
        assert mgr.turn_off() is True
        assert mgr._proc is None

    def test_kill_that_never_reaps_does_not_block_forever(self):
        """The post-SIGKILL wait() had no timeout and held DisplayManager._lock."""
        proc = self._proc()
        proc.wait.side_effect = subprocess.TimeoutExpired(cmd="chromium", timeout=5)
        mgr = make_manager(_proc=proc)
        assert mgr.turn_off() is True
        # Every wait() call must carry a timeout; an unbounded one deadlocks
        # is_on() and therefore every /api/display request.
        assert proc.wait.call_count >= 2
        for call in proc.wait.call_args_list:
            assert call.kwargs.get("timeout"), call

    def test_safe_turn_off_swallows_everything(self, capsys):
        mgr = make_manager()
        mgr.turn_off = mock.Mock(side_effect=RuntimeError("boom"))
        app_mod._safe_turn_off(mgr)          # must not raise
        app_mod._safe_turn_off(None)         # must not raise
        assert "display shutdown failed" in capsys.readouterr().err
