"""Disk usage collector for / and /home."""

from __future__ import annotations

import psutil

from chiketi.collectors.base import MetricCollector, MetricValue


def _tib(b: int) -> float:
    return round(b / (1024**4), 2)


def _gib(b: int) -> float:
    return round(b / (1024**3), 1)


class DiskCollector(MetricCollector):
    namespace = "disk"

    MOUNTS = ["/", "/home"]

    def collect(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}
        for mount in self.MOUNTS:
            key = mount.replace("/", "_").strip("_") or "root"
            try:
                usage = psutil.disk_usage(mount)
                total = usage.total
                used = usage.used
                # Use TiB if >= 1 TiB, else GiB
                if total >= 1024**4:
                    metrics[self._key(f"{key}_used")] = MetricValue(
                        value=_tib(used), unit="TiB",
                        extra={"total": _tib(total), "percent": usage.percent},
                    )
                    metrics[self._key(f"{key}_total")] = MetricValue(value=_tib(total), unit="TiB")
                else:
                    metrics[self._key(f"{key}_used")] = MetricValue(
                        value=_gib(used), unit="GiB",
                        extra={"total": _gib(total), "percent": usage.percent},
                    )
                    metrics[self._key(f"{key}_total")] = MetricValue(value=_gib(total), unit="GiB")
                metrics[self._key(f"{key}_percent")] = MetricValue(value=usage.percent, unit="%")
            except Exception:
                for suffix in ("used", "total", "percent"):
                    metrics[self._key(f"{key}_{suffix}")] = MetricValue(available=False)
        return metrics
