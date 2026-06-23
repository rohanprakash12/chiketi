"""MetricEngine thread, HTTP server, and Chromium kiosk launcher."""

from __future__ import annotations

import glob
import os
import shutil
import signal
import subprocess
import sys
import threading
import time

from chiketi.collectors.base import MetricCollector, MetricValue
from chiketi.collectors.registry import get_collectors
from chiketi.config import TIMING


class MetricEngine(threading.Thread):
    """Background thread that periodically collects metrics."""

    daemon = True

    def __init__(self) -> None:
        super().__init__()
        self._collectors: list[MetricCollector] = get_collectors()
        self._latest: dict[str, MetricValue] = {}
        self._running = True

    def run(self) -> None:
        while self._running:
            data: dict[str, MetricValue] = {}
            for collector in self._collectors:
                try:
                    result = collector.collect()
                    data.update(result)
                except Exception as exc:
                    print(f"chiketi: collector {type(collector).__name__} failed: {exc}",
                          file=sys.stderr)
            self._latest = data
            time.sleep(TIMING.collect_interval_ms / 1000)

    def stop(self) -> None:
        self._running = False

    def get_latest(self) -> dict[str, MetricValue]:
        return self._latest


def _find_chromium() -> str | None:
    """Find a Chromium-based browser on the system."""
    for name in ("chromium", "chromium-browser", "google-chrome"):
        path = shutil.which(name)
        if path:
            return path
    return None


def _is_wayland() -> bool:
    """Check if the current graphical session is Wayland.

    Trusts the session type (env, then loginctl) authoritatively. A bare
    process-name heuristic is unreliable because gnome-shell/mutter run under
    both X11 and Wayland, so it's only used as a last resort and limited to
    Wayland-exclusive compositors.
    """
    if os.environ.get("WAYLAND_DISPLAY"):
        return True
    session_type = os.environ.get("XDG_SESSION_TYPE", "").lower()
    if session_type == "wayland":
        return True
    if session_type == "x11":
        return False
    # Ask loginctl for the caller's session type (authoritative).
    try:
        result = subprocess.run(
            ["loginctl", "show-session", "auto", "--property=Type"],
            capture_output=True, text=True, timeout=5,
        )
        out = result.stdout.lower()
        if "type=wayland" in out:
            return True
        if "type=x11" in out:
            return False
    except Exception:
        pass
    # Last resort: only Wayland-exclusive compositors imply Wayland here.
    # gnome-shell/mutter are intentionally excluded (they also run on X11).
    try:
        result = subprocess.run(
            ["pgrep", "-a", "-f", "kwin_wayland|sway|weston|hyprland"],
            capture_output=True, text=True, timeout=5,
        )
        if result.stdout.strip():
            return True
    except Exception:
        pass
    return False


def _get_graphical_session_env() -> dict[str, str]:
    """Grab DISPLAY and WAYLAND_DISPLAY from an active graphical session.

    When running from SSH or a systemd service, these env vars aren't set.
    We find them from a running user session.
    """
    env = {}
    uid = os.getuid()

    # Try loginctl to find graphical sessions
    try:
        result = subprocess.run(
            ["loginctl", "list-sessions", "--no-legend"],
            capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.strip().splitlines():
            parts = line.split()
            if len(parts) < 3:
                continue
            session_id = parts[0]
            try:
                props = subprocess.run(
                    ["loginctl", "show-session", session_id,
                     "--property=Type", "--property=Display",
                     "--property=User", "--property=Name"],
                    capture_output=True, text=True, timeout=5,
                )
                prop_dict = {}
                for p in props.stdout.strip().splitlines():
                    if "=" in p:
                        k, v = p.split("=", 1)
                        prop_dict[k] = v
                if prop_dict.get("Type") not in ("x11", "wayland"):
                    continue
                # Found a graphical session — get its env vars
                # Try reading from /proc of a process in that session
                sess_leader = subprocess.run(
                    ["loginctl", "show-session", session_id, "--property=Leader"],
                    capture_output=True, text=True, timeout=5,
                )
                leader_pid = sess_leader.stdout.strip().split("=")[-1]
                if leader_pid and leader_pid.isdigit():
                    candidate = _read_env_from_proc(int(leader_pid))
                    if candidate:
                        # Merge into env but keep scanning if missing XAUTHORITY
                        env.update(candidate)
            except Exception:
                continue
    except Exception:
        pass

    # Fallback: scan /proc for a process with DISPLAY or WAYLAND_DISPLAY set
    # Prefer processes that also have XAUTHORITY (needed for XWayland)
    best = {}
    try:
        for proc_dir in sorted(glob.glob("/proc/[0-9]*")):
            try:
                if os.stat(proc_dir).st_uid != uid:
                    continue
                environ_path = os.path.join(proc_dir, "environ")
                with open(environ_path, "rb") as f:
                    environ_data = f.read().decode("utf-8", errors="replace")
                proc_env = {}
                for item in environ_data.split("\0"):
                    if "=" in item:
                        k, v = item.split("=", 1)
                        if k in ("DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY"):
                            proc_env[k] = v
                if not (proc_env.get("DISPLAY") or proc_env.get("WAYLAND_DISPLAY")):
                    continue
                # If this process has XAUTHORITY, it's the best match
                if proc_env.get("XAUTHORITY"):
                    return proc_env
                # Otherwise save as fallback
                if not best:
                    best = proc_env
            except (PermissionError, FileNotFoundError, ProcessLookupError):
                continue
    except Exception:
        pass

    return best or env


def _read_env_from_proc(pid: int) -> dict[str, str]:
    """Read display-related env vars from a process."""
    env = {}
    try:
        with open(f"/proc/{pid}/environ", "rb") as f:
            data = f.read().decode("utf-8", errors="replace")
        for item in data.split("\0"):
            if "=" in item:
                k, v = item.split("=", 1)
                if k in ("DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY"):
                    env[k] = v
    except Exception:
        pass
    return env


def _detect_display() -> str:
    """Auto-detect the active X display.

    Checks DISPLAY env var first, then looks for running X servers.
    """
    display = os.environ.get("DISPLAY")
    if display:
        return display

    # Try to get it from a graphical session
    session_env = _get_graphical_session_env()
    if session_env.get("DISPLAY"):
        return session_env["DISPLAY"]

    # Find running X servers by checking /tmp/.X*-lock files
    locks = sorted(glob.glob("/tmp/.X*-lock"))
    for lock in locks:
        try:
            with open(lock) as f:
                pid = int(f.read().strip())
            if os.path.isdir(f"/proc/{pid}"):
                num = lock.split(".X")[1].split("-lock")[0]
                # Skip XWayland high-numbered displays
                if int(num) < 100:
                    return f":{num}"
        except (ValueError, IndexError):
            continue

    return ":0"


class DisplayManager:
    """Manages the Chromium kiosk process — start/stop from control panel."""

    def __init__(self, display_url: str) -> None:
        self._url = display_url
        self._chromium = _find_chromium()
        self._wayland = _is_wayland()
        self._session_env = _get_graphical_session_env()
        self._display_env = self._session_env.get("DISPLAY") or _detect_display()
        self._screen_size = self._detect_screen_size()
        self._proc: subprocess.Popen | None = None
        self._adopted_pid: int | None = None
        self._lock = threading.Lock()
        self._x_vt = self._detect_x_vt() if not self._wayland else None
        self._adopt_existing()

        if self._wayland:
            print(f"chiketi: Wayland session detected")
        print(f"chiketi: using DISPLAY={self._display_env}")
        if self._screen_size:
            print(f"chiketi: screen size {self._screen_size[0]}x{self._screen_size[1]}")

    def _detect_screen_size(self) -> tuple[int, int] | None:
        """Detect the primary screen resolution via xrandr."""
        try:
            env = self._build_env()
            result = subprocess.run(
                ["xrandr", "--query"],
                capture_output=True, text=True, timeout=5, env=env,
            )
            for line in result.stdout.splitlines():
                if " connected" in line:
                    for part in line.split():
                        if "x" in part and part[0].isdigit():
                            res = part.split("+")[0]
                            w, h = res.split("x")
                            return (int(w), int(h))
        except Exception:
            pass
        return None

    def _detect_x_vt(self) -> int | None:
        """Detect which virtual terminal the X server is running on."""
        try:
            result = subprocess.run(
                ["pgrep", "-a", "-x", "Xorg"],
                capture_output=True, text=True, timeout=5,
            )
            for line in result.stdout.strip().splitlines():
                for part in line.split():
                    if part.startswith("vt"):
                        return int(part[2:])
        except Exception:
            pass
        return None

    def _adopt_existing(self) -> None:
        """Find a Chromium kiosk already showing our display URL."""
        try:
            result = subprocess.run(
                ["pgrep", "-a", "-f", "kiosk"],
                capture_output=True, text=True, timeout=5,
            )
            marker = f"--app={self._url}"
            for line in result.stdout.strip().splitlines():
                if marker in line:
                    pid = int(line.split()[0])
                    os.kill(pid, 0)
                    self._adopted_pid = pid
                    print(f"chiketi: adopted existing display (pid {pid})")
                    return
        except Exception:
            pass

    def _build_env(self) -> dict[str, str]:
        """Build the environment for launching Chromium."""
        env = {**os.environ}
        env["DISPLAY"] = self._display_env
        # Pass through session env vars (Wayland, X auth, runtime dir)
        for key in ("WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY"):
            val = self._session_env.get(key) or os.environ.get(key)
            if val:
                env[key] = val
        return env

    @property
    def is_on(self) -> bool:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                return True
            if self._adopted_pid is not None:
                try:
                    os.kill(self._adopted_pid, 0)
                    return True
                except OSError:
                    self._adopted_pid = None
            return False

    def _switch_vt(self, vt: int) -> None:
        """Switch to a virtual terminal (requires sudo/root)."""
        try:
            subprocess.run(
                ["sudo", "-n", "chvt", str(vt)],
                capture_output=True, timeout=5,
            )
        except Exception:
            pass

    def turn_on(self) -> bool:
        """Launch Chromium kiosk. Returns True if started."""
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                return True
            if self._adopted_pid is not None:
                try:
                    os.kill(self._adopted_pid, 0)
                    return True
                except OSError:
                    self._adopted_pid = None
            if not self._chromium:
                return False
            # Switch to X virtual terminal (X11 only)
            if self._x_vt and not self._wayland:
                self._switch_vt(self._x_vt)
            env = self._build_env()
            chrome_args = [
                self._chromium,
                "--kiosk",
                f"--app={self._url}",
                "--no-first-run",
                "--disable-translate",
                "--disable-infobars",
                "--disable-session-crashed-bubble",
                "--disable-features=TranslateUI",
                "--noerrdialogs",
                "--start-fullscreen",
            ]
            if self._screen_size:
                w, h = self._screen_size
                chrome_args.append(f"--window-size={w},{h}")
            if self._wayland:
                chrome_args.append("--ozone-platform=wayland")
            try:
                self._proc = subprocess.Popen(
                    chrome_args, env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                print(f"chiketi: display ON (pid {self._proc.pid})")
                return True
            except Exception as exc:
                print(f"chiketi: failed to start display: {exc}", file=sys.stderr)
                return False

    def turn_off(self) -> bool:
        """Stop Chromium kiosk. Returns True if stopped."""
        with self._lock:
            if self._adopted_pid is not None:
                try:
                    os.kill(self._adopted_pid, signal.SIGTERM)
                    print(f"chiketi: display OFF (adopted pid {self._adopted_pid})")
                except OSError:
                    pass
                self._adopted_pid = None
            if self._proc is not None and self._proc.poll() is None:
                try:
                    self._proc.terminate()
                    self._proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._proc.kill()
                    self._proc.wait()
                print("chiketi: display OFF")
            self._proc = None
            # Switch to console (X11 only — on Wayland, closing Chromium
            # just returns to the desktop)
            if self._x_vt and not self._wayland:
                self._switch_vt(1)
            return True


# Module-level display manager — set during run()
_display_mgr: DisplayManager | None = None


def get_display_manager() -> DisplayManager | None:
    return _display_mgr


def run(
    bind_host: str = "0.0.0.0",
    token: str | None = None,
) -> int:
    """Start metric engine, HTTP server, and Chromium kiosk. Returns exit code."""
    global _display_mgr

    # Start metric collection thread
    engine = MetricEngine()
    engine.start()

    from chiketi.server import start_server, set_metrics_source, CONTROL_PORT
    display_url = f"http://localhost:{CONTROL_PORT}/display"

    # Create the display manager up front so start_server() adopts it instead
    # of constructing a second one (which would re-probe the session twice).
    _display_mgr = DisplayManager(display_url)

    # Start control panel HTTP server (with metrics access)
    set_metrics_source(engine.get_latest)
    try:
        start_server(bind_host=bind_host, token=token)
    except OSError as exc:
        print(f"chiketi: control server failed to bind: {exc}", file=sys.stderr)
        return 1

    print(f"chiketi: server running on http://localhost:{CONTROL_PORT}/")
    print(f"chiketi: display at {display_url}")

    # Auto-start the kiosk
    if _display_mgr._chromium:
        _display_mgr.turn_on()
    else:
        print("chiketi: no Chromium browser found, running headless (server only)",
              file=sys.stderr)

    # Keep running until interrupted
    def _handle_term(signum, frame):
        _display_mgr.turn_off()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _handle_term)

    try:
        signal.pause()
    except (KeyboardInterrupt, SystemExit):
        pass

    _display_mgr.turn_off()
    engine.stop()
    return 0
