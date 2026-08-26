"""Gateway round-trip time, measured off the collect thread.

Why this is not part of NetworkCollector: a ping is a subprocess that takes as
long as the network takes to answer. Every collector runs in sequence on the
single MetricEngine thread, so a blocking ping on a 1.5s cycle would stall
every other metric behind it -- the same defect class as an unbounded HTTP
read. The probe therefore runs on its own daemon thread and collect() only
ever reads the last result it left behind.
"""

from __future__ import annotations

import re
import subprocess
import threading
import time

from chiketi.collectors.base import MetricCollector, MetricValue

# "64 bytes from 1.2.3.4: icmp_seq=1 ttl=64 time=0.510 ms"
_TIME_RE = re.compile(r"time[=<]\s*([\d.]+)\s*ms", re.IGNORECASE)
# "default via 192.168.16.1 dev enp1s0 proto static metric 100"
_GW_RE = re.compile(r"^default\s+via\s+(\S+)")


def _parse_rtt(stdout: str) -> float | None:
    """Pull the round-trip time in ms out of ping output, or None."""
    m = _TIME_RE.search(stdout or "")
    if not m:
        return None
    try:
        rtt = float(m.group(1))
    except (TypeError, ValueError):
        return None
    # A negative or absurd figure means we misread the output, not a fast link.
    return rtt if 0.0 <= rtt < 60_000.0 else None


def _parse_gateway(stdout: str) -> str | None:
    """Pull the default gateway address out of `ip route show default`."""
    for line in (stdout or "").splitlines():
        m = _GW_RE.match(line.strip())
        if m:
            return m.group(1)
    return None


class PingCollector(MetricCollector):
    """Round-trip time to the default gateway.

    The gateway rather than a public host on purpose: it measures the link the
    dashboard actually sits on, and it keeps the probe inside the LAN.
    """

    namespace = "net"

    _PROBE_INTERVAL_S = 5.0   # a glance screen does not need per-cycle latency
    _PING_TIMEOUT_S = 2.0     # hard ceiling on the subprocess
    _GW_REFRESH_S = 60.0      # re-discover the gateway occasionally

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self._rtt_ms: float | None = None
        self._gateway: str | None = None
        self._gateway_ts: float = 0.0
        self._stop = threading.Event()
        self._worker: threading.Thread | None = None

    # -- probing, on our own thread -------------------------------------

    def _discover_gateway(self) -> str | None:
        try:
            result = subprocess.run(
                ["ip", "route", "show", "default"],
                capture_output=True, text=True, timeout=3,
            )
            return _parse_gateway(result.stdout)
        # Broad: `ip` may be missing, the timeout may fire, and on an odd
        # system the call can fail in ways that are not OSError. A collector
        # that raises loses every metric for that cycle.
        except Exception:
            return None

    def _ping_once(self, target: str) -> float | None:
        try:
            result = subprocess.run(
                # -n: no reverse DNS, which is its own unbounded wait.
                ["ping", "-c", "1", "-W", str(int(self._PING_TIMEOUT_S)), "-n", target],
                capture_output=True, text=True,
                timeout=self._PING_TIMEOUT_S + 1,
            )
            if result.returncode != 0:
                return None
            return _parse_rtt(result.stdout)
        except Exception:
            return None

    def _run(self) -> None:
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                with self._lock:
                    gw, gw_ts = self._gateway, self._gateway_ts
                if gw is None or (started - gw_ts) > self._GW_REFRESH_S:
                    gw = self._discover_gateway()
                    with self._lock:
                        self._gateway = gw
                        self._gateway_ts = started
                rtt = self._ping_once(gw) if gw else None
                with self._lock:
                    self._rtt_ms = rtt
            except Exception:
                with self._lock:
                    self._rtt_ms = None
            # Sleep the remainder, interruptibly, so stop() returns promptly.
            self._stop.wait(max(0.0, self._PROBE_INTERVAL_S - (time.monotonic() - started)))

    def _ensure_worker(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return
        self._stop.clear()
        self._worker = threading.Thread(target=self._run, daemon=True)
        self._worker.start()

    def stop(self) -> None:
        """Stop probing. Safe to call more than once."""
        self._stop.set()

    # -- the collect thread only ever reads --------------------------------

    def collect(self) -> dict[str, MetricValue]:
        self._ensure_worker()
        with self._lock:
            rtt, gw = self._rtt_ms, self._gateway
        if rtt is None:
            return {self._key("ping"): MetricValue(available=False, unit="ms")}
        return {
            self._key("ping"): MetricValue(
                value=round(rtt, 1), unit="ms", extra={"target": gw or ""}
            )
        }
