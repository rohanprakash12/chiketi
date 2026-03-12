"""CPU temperature, usage, and fan speed collector."""

from __future__ import annotations

import psutil

from chiketi.collectors.base import MetricCollector, MetricValue


class CpuCollector(MetricCollector):
    namespace = "cpu"

    def __init__(self) -> None:
        super().__init__()
        self._active_fan_indices: set[int] = set()
        # Warm up psutil's per-CPU measurement
        try:
            psutil.cpu_percent(percpu=True)
        except Exception:
            pass

    def collect(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}

        # Overall usage
        try:
            usage = psutil.cpu_percent(interval=None)
            metrics[self._key("usage")] = MetricValue(value=usage, unit="%")
        except Exception:
            metrics[self._key("usage")] = MetricValue(available=False, unit="%")

        # Per-core usage
        try:
            per_core = psutil.cpu_percent(interval=None, percpu=True)
            metrics[self._key("per_core")] = MetricValue(value=per_core, unit="%")
        except Exception:
            metrics[self._key("per_core")] = MetricValue(available=False)

        # Temperature (Linux via psutil sensors)
        try:
            temps = psutil.sensors_temperatures()
            temp_val: float | None = None
            for chip in ("coretemp", "k10temp", "cpu_thermal"):
                if chip in temps and temps[chip]:
                    temp_val = temps[chip][0].current
                    break
            if temp_val is None and temps:
                first = next(iter(temps.values()))
                if first:
                    temp_val = first[0].current
            if temp_val is not None:
                metrics[self._key("temp")] = MetricValue(value=round(temp_val), unit="°C")
            else:
                metrics[self._key("temp")] = MetricValue(available=False, unit="°C")
        except Exception:
            metrics[self._key("temp")] = MetricValue(available=False, unit="°C")

        # Motherboard temperature
        try:
            temps = psutil.sensors_temperatures()
            mb_temp: float | None = None
            for chip in ("acpitz", "nct6775", "nct6776", "nct6779", "it8688", "it8792"):
                if chip in temps and temps[chip]:
                    # Look for systin or first entry
                    for entry in temps[chip]:
                        label = (entry.label or "").lower()
                        if "systin" in label or "system" in label or "mb" in label:
                            mb_temp = entry.current
                            break
                    if mb_temp is None and temps[chip]:
                        mb_temp = temps[chip][0].current
                    if mb_temp is not None:
                        break
            if mb_temp is None and "acpitz" in temps and temps["acpitz"]:
                mb_temp = temps["acpitz"][0].current
            if mb_temp is not None:
                metrics[self._key("mb_temp")] = MetricValue(value=round(mb_temp), unit="°C")
            else:
                metrics[self._key("mb_temp")] = MetricValue(available=False, unit="°C")
        except Exception:
            metrics[self._key("mb_temp")] = MetricValue(available=False, unit="°C")

        # Fan speeds — classify as cpu/case based on header position
        # Convention: first 2 headers are CPU zone, rest are case fans.
        # Only report fans with RPM > 0 (connected and spinning) or
        # previously seen spinning (to show stopped state).
        try:
            fans = psutil.sensors_fans()
            all_fans: list[tuple[int, str, float]] = []
            if fans:
                idx = 0
                for chip_fans in fans.values():
                    for fan_entry in chip_fans:
                        label = fan_entry.label or f"fan{idx}"
                        all_fans.append((idx, label, fan_entry.current))
                        idx += 1

            cpu_fans: list[float] = []
            case_fans: list[float] = []
            for idx, label, rpm in all_fans:
                if rpm > 0:
                    # Track which fans have been seen active
                    self._active_fan_indices.add(idx)
                if idx in self._active_fan_indices:
                    if idx < 2:
                        cpu_fans.append(rpm)
                    else:
                        case_fans.append(rpm)

            metrics[self._key("fans_cpu")] = MetricValue(
                value=cpu_fans, extra={"count": len(cpu_fans)}
            )
            metrics[self._key("fans_case")] = MetricValue(
                value=case_fans, extra={"count": len(case_fans)}
            )
            # Keep backward compat
            metrics[self._key("fan_count")] = MetricValue(
                value=len(cpu_fans) + len(case_fans)
            )
            first_rpm = (cpu_fans + case_fans + [0])[0]
            metrics[self._key("fan")] = MetricValue(
                value=first_rpm, unit="RPM",
                available=bool(cpu_fans or case_fans),
            )
        except Exception:
            metrics[self._key("fan")] = MetricValue(available=False, unit="RPM")
            metrics[self._key("fan_count")] = MetricValue(value=0)
            metrics[self._key("fans_cpu")] = MetricValue(value=[], extra={"count": 0})
            metrics[self._key("fans_case")] = MetricValue(value=[], extra={"count": 0})

        return metrics
