"""Full GPU stats via pynvml, across every card present.

Shape note: the flat ``gpu.name`` / ``gpu.temp`` / ``gpu.vram_used`` keys are
kept and mirror card 0, because every shipped renderer reads them. Multi-card
data arrives alongside as ``gpu.count`` and ``gpu.cards``, so nothing that
works today changes behaviour on a single-card box.
"""

from __future__ import annotations

import time

from chiketi.collectors.base import MetricCollector, MetricValue
from chiketi.collectors.gpu_sysfs import short_name

_nvml_initialized = False
_nvml_last_attempt = 0.0
_NVML_RETRY_S = 30.0

# Fields mirrored from card 0 into the flat, pre-existing key names.
_FLAT_KEYS = ("name", "temp", "fan", "power", "vram_used", "vram_total",
              "vram_percent", "util", "mem_util", "clock_gpu", "clock_mem")


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


# NVML reports "not supported" for per-process memory as an all-ones sentinel
# rather than an error. It is truthy, so a bare `if p.usedGpuMemory` lets it
# through and it renders as ~17.6 million MiB.
_NVML_VALUE_NOT_AVAILABLE = (1 << 64) - 1
_MAX_PLAUSIBLE_VRAM_MIB = 2 * 1024 * 1024      # 2 TiB, far above any real card


def _proc_vram_mib(raw) -> int:
    """Per-process VRAM in MiB, or 0 when NVML says it does not know."""
    if not isinstance(raw, int) or raw <= 0:
        return 0
    if raw >= _NVML_VALUE_NOT_AVAILABLE:
        return 0
    mib = round(raw / (1024 ** 2))
    return mib if mib <= _MAX_PLAUSIBLE_VRAM_MIB else 0


def _text(value) -> str | None:
    """NVML returns str on new pynvml, bytes on old. Normalise, or give up."""
    if isinstance(value, bytes):
        try:
            return value.decode()
        except Exception:
            return None
    return value if isinstance(value, str) else None


class GpuNvidiaCollector(MetricCollector):
    namespace = "gpu"

    # ------------------------------------------------------------------
    # one card
    # ------------------------------------------------------------------

    def _read_card(self, pynvml, handle, index: int) -> dict:
        """Read one card. Every field is guarded on its own: a card that
        refuses one reading still contributes the rest."""
        card: dict = {"index": index}

        try:
            card["name"] = _text(pynvml.nvmlDeviceGetName(handle)) or f"GPU {index}"
        except Exception:
            card["name"] = f"GPU {index}"

        try:
            info = pynvml.nvmlDeviceGetPciInfo(handle)
            card["bus_id"] = _text(getattr(info, "busId", None))
        except Exception:
            card["bus_id"] = None

        try:
            card["temp"] = pynvml.nvmlDeviceGetTemperature(
                handle, pynvml.NVML_TEMPERATURE_GPU)
        except Exception:
            card["temp"] = None

        try:
            card["fan"] = pynvml.nvmlDeviceGetFanSpeed(handle)
        except Exception:
            card["fan"] = None

        try:
            card["power"] = round(pynvml.nvmlDeviceGetPowerUsage(handle) / 1000)
        except Exception:
            card["power"] = None
        try:
            card["power_limit"] = round(
                pynvml.nvmlDeviceGetPowerManagementLimit(handle) / 1000)
        except Exception:
            card["power_limit"] = None

        try:
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            card["vram_used"] = round(mem.used / (1024 ** 2))
            card["vram_total"] = round(mem.total / (1024 ** 2))
            card["vram_percent"] = (round(mem.used / mem.total * 100, 1)
                                    if mem.total else 0.0)
        except Exception:
            card["vram_used"] = card["vram_total"] = card["vram_percent"] = None

        try:
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            card["util"] = util.gpu
            card["mem_util"] = util.memory
        except Exception:
            card["util"] = card["mem_util"] = None

        try:
            card["clock_gpu"] = pynvml.nvmlDeviceGetClockInfo(
                handle, pynvml.NVML_CLOCK_GRAPHICS)
            card["clock_gpu_max"] = pynvml.nvmlDeviceGetMaxClockInfo(
                handle, pynvml.NVML_CLOCK_GRAPHICS)
        except Exception:
            card["clock_gpu"] = card["clock_gpu_max"] = None
        try:
            card["clock_mem"] = pynvml.nvmlDeviceGetClockInfo(
                handle, pynvml.NVML_CLOCK_MEM)
            card["clock_mem_max"] = pynvml.nvmlDeviceGetMaxClockInfo(
                handle, pynvml.NVML_CLOCK_MEM)
        except Exception:
            card["clock_mem"] = card["clock_mem_max"] = None

        procs = []
        try:
            for p in pynvml.nvmlDeviceGetComputeRunningProcesses(handle):
                name = "unknown"
                try:
                    name = (_text(pynvml.nvmlSystemGetProcessName(p.pid))
                            or "unknown").rsplit("/", 1)[-1]
                except Exception:
                    pass
                procs.append({
                    "pid": p.pid, "name": name,
                    "vram_mib": _proc_vram_mib(p.usedGpuMemory),
                })
        except Exception:
            pass
        card["processes"] = procs
        return card

    # ------------------------------------------------------------------
    # every card
    # ------------------------------------------------------------------

    def read_cards(self) -> list[dict]:
        """Every NVIDIA card NVML can see. Empty when there are none."""
        if not _ensure_nvml():
            return []
        try:
            import pynvml
            count = pynvml.nvmlDeviceGetCount()
        except Exception:
            return []

        cards: list[dict] = []
        for i in range(count):
            try:
                handle = pynvml.nvmlDeviceGetHandleByIndex(i)
            # One card failing to enumerate must not cost the others - a
            # mixed rig with a dead or busy device still reports the rest.
            except Exception:
                continue
            try:
                card = self._read_card(pynvml, handle, i)
            except Exception:
                continue
            card["source"] = "nvml"
            card["vendor"] = "NVIDIA"
            # NVML does not report the kernel module or a short name; without
            # these the screen header renders "-- | <bus id>" on a real card.
            card["driver"] = "nvidia"
            card["short_name"] = short_name(card.get("name")) or card.get("name")
            # Keys the sysfs reader always sets. Both sources must produce the
            # same shape: gpu.cards is public API, and a consumer indexing
            # card["fan_rpm"] should not have to know which source found it.
            # NVML reports fan as a duty percentage only, never a tachometer
            # reading, so None here is the honest value rather than a gap.
            card.setdefault("fan_rpm", None)
            card.setdefault("vendor_id", "0x10de")
            cards.append(card)
        return cards

    def collect(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}
        cards = self.read_cards()
        if not cards:
            return self._all_unavailable(metrics)

        metrics[self._key("count")] = MetricValue(value=len(cards))
        metrics[self._key("cards")] = MetricValue(
            value=cards, extra={"count": len(cards)})

        # Flat keys mirror card 0 so existing renderers are untouched.
        first = cards[0]
        for key in _FLAT_KEYS:
            val = first.get(key)
            if val is None:
                metrics[self._key(key)] = MetricValue(available=False)
                continue
            unit = {"temp": "°C", "fan": "%", "power": "W", "util": "%",
                    "mem_util": "%", "vram_used": "MiB", "vram_total": "MiB",
                    "vram_percent": "%", "clock_gpu": "MHz",
                    "clock_mem": "MHz"}.get(key, "")
            extra: dict = {}
            if key == "power" and first.get("power_limit") is not None:
                extra["limit"] = first["power_limit"]
            if key == "vram_used" and first.get("vram_total") is not None:
                extra = {"total": first["vram_total"],
                         "percent": first.get("vram_percent")}
            if key == "clock_gpu" and first.get("clock_gpu_max") is not None:
                extra["max"] = first["clock_gpu_max"]
            if key == "clock_mem" and first.get("clock_mem_max") is not None:
                extra["max"] = first["clock_mem_max"]
            metrics[self._key(key)] = MetricValue(value=val, unit=unit, extra=extra)

        metrics[self._key("processes")] = MetricValue(value=first["processes"])
        return metrics

    def _all_unavailable(self, metrics: dict[str, MetricValue]) -> dict[str, MetricValue]:
        for k in _FLAT_KEYS:
            metrics[self._key(k)] = MetricValue(available=False)
        metrics[self._key("processes")] = MetricValue(value=[])
        metrics[self._key("count")] = MetricValue(value=0)
        metrics[self._key("cards")] = MetricValue(value=[], extra={"count": 0})
        return metrics
