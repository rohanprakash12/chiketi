"""Full GPU stats via pynvml."""

from __future__ import annotations

import time

from chiketi.collectors.base import MetricCollector, MetricValue

_nvml_initialized = False
_nvml_last_attempt = 0.0
_NVML_RETRY_S = 30.0


def _ensure_nvml() -> bool:
    """Init NVML once. On failure, throttle retries so a GPU-less host doesn't
    re-import pynvml and call nvmlInit() on every collect cycle. A later-loaded
    driver is still picked up after the retry window."""
    global _nvml_initialized, _nvml_last_attempt
    if _nvml_initialized:
        return True
    now = time.monotonic()
    if _nvml_last_attempt and (now - _nvml_last_attempt) < _NVML_RETRY_S:
        return False
    _nvml_last_attempt = now
    try:
        import pynvml
        pynvml.nvmlInit()
        _nvml_initialized = True
        return True
    except Exception:
        return False


class GpuNvidiaCollector(MetricCollector):
    namespace = "gpu"

    def collect(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}
        if not _ensure_nvml():
            return self._all_unavailable(metrics)

        try:
            import pynvml

            handle = pynvml.nvmlDeviceGetHandleByIndex(0)

            # Name
            try:
                name = pynvml.nvmlDeviceGetName(handle)
                if isinstance(name, bytes):
                    name = name.decode()
                metrics[self._key("name")] = MetricValue(value=name)
            except Exception:
                metrics[self._key("name")] = MetricValue(available=False)

            # Temperature
            try:
                temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
                metrics[self._key("temp")] = MetricValue(value=temp, unit="°C")
            except Exception:
                metrics[self._key("temp")] = MetricValue(available=False, unit="°C")

            # Fan speed
            try:
                fan = pynvml.nvmlDeviceGetFanSpeed(handle)
                metrics[self._key("fan")] = MetricValue(value=fan, unit="%")
            except Exception:
                metrics[self._key("fan")] = MetricValue(available=False, unit="%")

            # Power
            try:
                power_mw = pynvml.nvmlDeviceGetPowerUsage(handle)
                power_limit_mw = pynvml.nvmlDeviceGetPowerManagementLimit(handle)
                metrics[self._key("power")] = MetricValue(
                    value=round(power_mw / 1000), unit="W",
                    extra={"limit": round(power_limit_mw / 1000)},
                )
            except Exception:
                metrics[self._key("power")] = MetricValue(available=False, unit="W")

            # VRAM
            try:
                mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
                used_mib = round(mem.used / (1024**2))
                total_mib = round(mem.total / (1024**2))
                percent = (mem.used / mem.total * 100) if mem.total > 0 else 0
                metrics[self._key("vram_used")] = MetricValue(
                    value=used_mib, unit="MiB",
                    extra={"total": total_mib, "percent": round(percent, 1)},
                )
                metrics[self._key("vram_total")] = MetricValue(value=total_mib, unit="MiB")
                metrics[self._key("vram_percent")] = MetricValue(value=round(percent, 1), unit="%")
            except Exception:
                for k in ("vram_used", "vram_total", "vram_percent"):
                    metrics[self._key(k)] = MetricValue(available=False)

            # Utilization
            try:
                util = pynvml.nvmlDeviceGetUtilizationRates(handle)
                metrics[self._key("util")] = MetricValue(value=util.gpu, unit="%")
                metrics[self._key("mem_util")] = MetricValue(value=util.memory, unit="%")
            except Exception:
                metrics[self._key("util")] = MetricValue(available=False, unit="%")
                metrics[self._key("mem_util")] = MetricValue(available=False, unit="%")

            # Clocks
            try:
                gpu_clk = pynvml.nvmlDeviceGetClockInfo(handle, pynvml.NVML_CLOCK_GRAPHICS)
                gpu_max = pynvml.nvmlDeviceGetMaxClockInfo(handle, pynvml.NVML_CLOCK_GRAPHICS)
                mem_clk = pynvml.nvmlDeviceGetClockInfo(handle, pynvml.NVML_CLOCK_MEM)
                mem_max = pynvml.nvmlDeviceGetMaxClockInfo(handle, pynvml.NVML_CLOCK_MEM)
                metrics[self._key("clock_gpu")] = MetricValue(
                    value=gpu_clk, unit="MHz", extra={"max": gpu_max},
                )
                metrics[self._key("clock_mem")] = MetricValue(
                    value=mem_clk, unit="MHz", extra={"max": mem_max},
                )
            except Exception:
                metrics[self._key("clock_gpu")] = MetricValue(available=False, unit="MHz")
                metrics[self._key("clock_mem")] = MetricValue(available=False, unit="MHz")

            # CUDA processes
            try:
                procs = pynvml.nvmlDeviceGetComputeRunningProcesses(handle)
                proc_list = []
                for p in procs:
                    name = "unknown"
                    try:
                        name = pynvml.nvmlSystemGetProcessName(p.pid)
                        if isinstance(name, bytes):
                            name = name.decode()
                        # Get just the binary name
                        name = name.rsplit("/", 1)[-1]
                    except Exception:
                        pass
                    proc_list.append({
                        "pid": p.pid,
                        "name": name,
                        "vram_mib": round(p.usedGpuMemory / (1024**2)) if p.usedGpuMemory else 0,
                    })
                metrics[self._key("processes")] = MetricValue(value=proc_list)
            except Exception:
                metrics[self._key("processes")] = MetricValue(value=[])

        except Exception:
            return self._all_unavailable(metrics)

        return metrics

    def _all_unavailable(self, metrics: dict[str, MetricValue]) -> dict[str, MetricValue]:
        for k in ("name", "temp", "fan", "power", "vram_used", "vram_total",
                   "vram_percent", "util", "mem_util", "clock_gpu", "clock_mem"):
            metrics[self._key(k)] = MetricValue(available=False)
        metrics[self._key("processes")] = MetricValue(value=[])
        return metrics
