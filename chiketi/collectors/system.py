"""Uptime, hostname, kernel and process-table collector."""

from __future__ import annotations

import platform
import socket
import time

import psutil

from chiketi.collectors.base import MetricCollector, MetricValue


class SystemCollector(MetricCollector):
    namespace = "sys"

    def __init__(self) -> None:
        self._procs_cache: MetricValue | None = None
        self._procs_at: float = 0.0

    def collect(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}
        try:
            metrics[self._key("hostname")] = MetricValue(value=socket.gethostname())
        except Exception:
            metrics[self._key("hostname")] = MetricValue(available=False)

        try:
            boot = psutil.boot_time()
            uptime_s = time.time() - boot
            days = int(uptime_s // 86400)
            hours = int((uptime_s % 86400) // 3600)
            mins = int((uptime_s % 3600) // 60)
            metrics[self._key("uptime")] = MetricValue(
                value=f"{days}d {hours}h {mins}m",
                extra={"seconds": uptime_s},
            )
        except Exception:
            metrics[self._key("uptime")] = MetricValue(available=False)

        try:
            metrics[self._key("kernel")] = MetricValue(value=platform.release())
        except Exception:
            metrics[self._key("kernel")] = MetricValue(available=False)

        metrics[self._key("top_procs")] = self._cached_top_procs()
        return metrics

    # Walking /proc costs ~30ms here and several times that on a Pi, on the one
    # thread every other collector shares. The ranking does not move fast
    # enough to be worth that every second, so it refreshes on its own clock
    # and the cached value is served in between.
    _PROC_REFRESH_S = 3.0

    def _cached_top_procs(self) -> MetricValue:
        now = time.monotonic()
        if self._procs_cache is None or now - self._procs_at >= self._PROC_REFRESH_S:
            self._procs_cache = self._top_procs()
            self._procs_at = now
        return self._procs_cache

    def _top_procs(self, limit: int = 5) -> MetricValue:
        """The busiest processes, as conky's top block shows them.

        cpu_percent() with no interval measures since the previous call, so the
        first collect after startup reports 0.0 for everything and the ranking
        only means something from the second tick. That is honest -- inventing
        a blocking sample here would stall the single collector thread for a
        second on every poll.

        Sorting is by CPU with memory as the tie-break, so an idle machine
        still ranks its processes by something rather than by pid order.
        """
        try:
            procs = []
            for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
                info = p.info
                name = info.get("name")
                if not name:
                    continue
                procs.append({
                    "name": name,
                    "pid": info.get("pid"),
                    "cpu": float(info.get("cpu_percent") or 0.0),
                    "mem": float(info.get("memory_percent") or 0.0),
                })
            procs.sort(key=lambda d: (d["cpu"], d["mem"]), reverse=True)
            return MetricValue(value=procs[:limit], extra={"total": len(procs)})
        except Exception:
            return MetricValue(available=False)
