"""Disk usage collector for / and any genuinely separate /home."""

from __future__ import annotations

import os

import psutil

from chiketi.collectors.base import MetricCollector, MetricValue


def _tib(b: int) -> float:
    return round(b / (1024**4), 2)


def _gib(b: int) -> float:
    return round(b / (1024**3), 1)


def _same_filesystem(a: str, b: str) -> bool:
    """True when two paths live on the same device.

    psutil.disk_usage("/home") does not fail when /home is just a directory on
    the root filesystem -- it happily returns the root filesystem's numbers.
    Reported as disk.home_* those become a second bar showing the same disk
    twice, which every theme then renders as two identical readings.
    """
    try:
        return os.stat(a).st_dev == os.stat(b).st_dev
    except Exception:
        # Cannot tell: report the mount rather than silently dropping a real
        # second disk. A duplicate reading beats a missing one.
        return False


class DiskCollector(MetricCollector):
    namespace = "disk"

    MOUNTS = ["/", "/home"]

    def collect(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}
        for mount in self.MOUNTS:
            key = mount.replace("/", "_").strip("_") or "root"
            if mount != "/" and _same_filesystem(mount, "/"):
                # Not a separate volume; the renderers show "SECONDARY - NONE".
                for suffix in ("used", "total", "percent"):
                    metrics[self._key(f"{key}_{suffix}")] = MetricValue(available=False)
                continue
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
