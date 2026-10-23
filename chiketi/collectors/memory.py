"""RAM and Swap collector."""

from __future__ import annotations

import psutil

from chiketi.collectors.base import MetricCollector, MetricValue


def _gib(b: int) -> float:
    return round(b / (1024**3), 1)


class MemoryCollector(MetricCollector):
    namespace = "mem"

    def collect(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}
        try:
            vm = psutil.virtual_memory()
            metrics[self._key("ram_used")] = MetricValue(
                value=_gib(vm.used), unit="GiB",
                extra={"total": _gib(vm.total), "percent": vm.percent},
            )
            metrics[self._key("ram_total")] = MetricValue(value=_gib(vm.total), unit="GiB")
            metrics[self._key("ram_percent")] = MetricValue(value=vm.percent, unit="%")
        except Exception:
            for k in ("ram_used", "ram_total", "ram_percent"):
                metrics[self._key(k)] = MetricValue(available=False)

        try:
            sw = psutil.swap_memory()
            metrics[self._key("swap_used")] = MetricValue(
                value=_gib(sw.used), unit="GiB",
                extra={"total": _gib(sw.total), "percent": sw.percent},
            )
            metrics[self._key("swap_total")] = MetricValue(value=_gib(sw.total), unit="GiB")
            metrics[self._key("swap_percent")] = MetricValue(value=sw.percent, unit="%")
        except Exception:
            for k in ("swap_used", "swap_total", "swap_percent"):
                metrics[self._key(k)] = MetricValue(available=False)
        return metrics
