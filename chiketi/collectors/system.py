"""Uptime and hostname collector."""

from __future__ import annotations

import socket
import time

import psutil

from chiketi.collectors.base import MetricCollector, MetricValue


class SystemCollector(MetricCollector):
    namespace = "sys"

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
        return metrics
