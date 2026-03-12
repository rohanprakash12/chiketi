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


def run(
    target_screen: str | None = None,
) -> int:
    """Start metric engine, HTTP server, and Chromium kiosk. Returns exit code."""
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

    # Find and launch Chromium
    chromium = _find_chromium()
    if not chromium:
        print("chiketi: no Chromium browser found, running headless (server only)", file=sys.stderr)
        print(f"chiketi: open {display_url} in a browser to view the dashboard")
        try:
            signal.pause()
        except KeyboardInterrupt:
            pass
        engine.stop()
        return 0

    # Build Chromium args for kiosk mode
    display_env = os.environ.get("DISPLAY", ":1")
    env = {**os.environ, "DISPLAY": display_env}

    chrome_args = [
        chromium,
        "--kiosk",
        f"--app={display_url}",
        "--no-first-run",
        "--disable-translate",
        "--disable-infobars",
        "--disable-session-crashed-bubble",
        "--disable-features=TranslateUI",
        "--noerrdialogs",
        "--window-size=1024,600",
        "--window-position=0,0",
    ]

    print(f"chiketi: launching {os.path.basename(chromium)} on DISPLAY={display_env}")

    try:
        proc = subprocess.Popen(chrome_args, env=env,
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL)

        # Forward SIGTERM to Chromium for clean shutdown
        def _handle_term(signum, frame):
            proc.terminate()

        signal.signal(signal.SIGTERM, _handle_term)

        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        proc.wait()

    engine.stop()
    return 0
