"""MetricEngine thread, HTTP server, and Chromium kiosk launcher."""

from __future__ import annotations

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


def _detect_display() -> str:
    """Auto-detect the active X display.

    Checks DISPLAY env var first, then looks for running X servers.
    """
    # Use env if already set
    display = os.environ.get("DISPLAY")
    if display:
        return display

    # Find running X servers by checking /tmp/.X*-lock files
    import glob
    locks = sorted(glob.glob("/tmp/.X*-lock"))
    for lock in locks:
        try:
            with open(lock) as f:
                pid = int(f.read().strip())
            # Check if process exists (works even for root-owned processes)
            if os.path.isdir(f"/proc/{pid}"):
                num = lock.split(".X")[1].split("-lock")[0]
                return f":{num}"
        except (ValueError, IndexError):
            continue

    return ":0"  # fallback


class DisplayManager:
    """Manages the Chromium kiosk process — start/stop from control panel."""

    def __init__(self, display_url: str) -> None:
        self._url = display_url
        self._chromium = _find_chromium()
        self._display_env = _detect_display()
        self._proc: subprocess.Popen | None = None
        self._adopted_pid: int | None = None  # PID of pre-existing Chromium
        self._lock = threading.Lock()
        # Figure out which VT the X server is on
        self._x_vt = self._detect_x_vt()
        # Detect already-running kiosk
        self._adopt_existing()

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
        return 7  # sensible default

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
                    os.kill(pid, 0)  # verify it exists
                    self._adopted_pid = pid
                    print(f"chiketi: adopted existing display (pid {pid})")
                    return
        except Exception:
            pass

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
            # Check managed process
            if self._proc is not None and self._proc.poll() is None:
                return True
            # Check adopted process
            if self._adopted_pid is not None:
                try:
                    os.kill(self._adopted_pid, 0)
                    return True
                except OSError:
                    self._adopted_pid = None
            if not self._chromium:
                return False
            # Switch to X virtual terminal
            if self._x_vt:
                self._switch_vt(self._x_vt)
            env = {**os.environ, "DISPLAY": self._display_env}
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
                "--window-size=1024,600",
                "--window-position=0,0",
            ]
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
        """Stop Chromium kiosk and switch to console. Returns True if stopped."""
        with self._lock:
            # Stop adopted process
            if self._adopted_pid is not None:
                try:
                    os.kill(self._adopted_pid, signal.SIGTERM)
                    print(f"chiketi: display OFF (adopted pid {self._adopted_pid})")
                except OSError:
                    pass
                self._adopted_pid = None
            # Stop managed process
            if self._proc is not None and self._proc.poll() is None:
                try:
                    self._proc.terminate()
                    self._proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._proc.kill()
                    self._proc.wait()
                print("chiketi: display OFF")
            self._proc = None
            # Switch to console tty1 (login prompt)
            self._switch_vt(1)
            return True


# Module-level display manager — set during run()
_display_mgr: DisplayManager | None = None


def get_display_manager() -> DisplayManager | None:
    return _display_mgr


def run(
    target_screen: str | None = None,
) -> int:
    """Start metric engine, HTTP server, and Chromium kiosk. Returns exit code."""
    global _display_mgr

    # Start metric collection thread
    engine = MetricEngine()
    engine.start()

    # Start control panel HTTP server (with metrics access)
    from chiketi.server import start_server, set_metrics_source, CONTROL_PORT
    set_metrics_source(engine.get_latest)
    try:
        start_server()
    except OSError as exc:
        print(f"chiketi: control server failed to bind: {exc}", file=sys.stderr)
        return 1

    display_url = f"http://localhost:{CONTROL_PORT}/display"
    print(f"chiketi: server running on http://localhost:{CONTROL_PORT}/")
    print(f"chiketi: display at {display_url}")

    # Create display manager and auto-start
    _display_mgr = DisplayManager(display_url)
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
