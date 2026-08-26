"""Every GPU on the machine, whatever its vendor.

Two sources, because no single one covers the field:
  * NVML  - the only way to get NVIDIA telemetry, and richer than sysfs where
            it applies (per-process VRAM, memory-controller utilisation).
  * sysfs - the only source that needs no vendor package and no privileges,
            and the only one that sees AMD and Intel at all.

They are merged rather than chosen between: a workstation can hold an NVIDIA
card and an AMD card at once, and the dashboard should show both.

The scan runs on its own thread. A sysfs attribute read is a synchronous call
into the driver, and a wedged card can make one block; on the single
MetricEngine thread that would stall CPU, memory, disk and network behind it.
collect() only ever reads the last result the scanner left behind - the same
shape as PingCollector, and for the same reason.
"""

from __future__ import annotations

import threading
import time

from chiketi.collectors.base import MetricCollector, MetricValue
from chiketi.collectors.gpu_nvidia import GpuNvidiaCollector
from chiketi.collectors.gpu_sysfs import normalize_bus_id, read_sysfs_cards

# Mirrored from card 0 into the flat, pre-existing key names. Every shipped
# renderer reads these, so they keep working untouched on a single-card box.
_FLAT_KEYS = ("name", "temp", "fan", "power", "vram_used", "vram_total",
              "vram_percent", "util", "mem_util", "clock_gpu", "clock_mem")

_UNITS = {
    "temp": "°C", "fan": "%", "power": "W", "util": "%", "mem_util": "%",
    "vram_used": "MiB", "vram_total": "MiB", "vram_percent": "%",
    "clock_gpu": "MHz", "clock_mem": "MHz",
}


def merge_cards(nvml_cards: list[dict], sysfs_cards: list[dict]) -> list[dict]:
    """One list per physical card, NVML winning where both saw the same device.

    An NVIDIA card with the proprietary driver loaded appears in BOTH sources -
    in sysfs with almost every attribute missing. Without the dedupe it would
    be listed twice, once fully and once nearly blank. Matching is on the PCI
    address, normalised because NVML pads the domain to eight digits and sysfs
    does not.
    """
    merged: list[dict] = []
    seen: set[str] = set()

    for card in nvml_cards:
        key = normalize_bus_id(card.get("bus_id"))
        if key:
            seen.add(key)
        merged.append(card)

    for card in sysfs_cards:
        key = normalize_bus_id(card.get("bus_id"))
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        merged.append(card)

    # Renumber: each source indexes from zero, so a merged list would
    # otherwise carry two cards claiming index 0.
    for i, card in enumerate(merged):
        card["index"] = i
    return merged


class GpuCollector(MetricCollector):
    namespace = "gpu"

    _SCAN_INTERVAL_S = 2.0

    def __init__(self) -> None:
        super().__init__()
        self._nvidia = GpuNvidiaCollector()
        self._lock = threading.Lock()
        self._cards: list[dict] = []
        self._scanned = False
        self._stop = threading.Event()
        self._worker: threading.Thread | None = None

    # -- scanning, on our own thread ------------------------------------

    def _scan_once(self) -> list[dict]:
        try:
            nvml = self._nvidia.read_cards()
        except Exception:
            nvml = []
        try:
            sysfs = read_sysfs_cards()
        except Exception:
            sysfs = []
        try:
            return merge_cards(nvml, sysfs)
        except Exception:
            return nvml or sysfs

    def _run(self) -> None:
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                cards = self._scan_once()
            except Exception:
                cards = []
            with self._lock:
                self._cards = cards
                self._scanned = True
            self._stop.wait(max(0.0, self._SCAN_INTERVAL_S - (time.monotonic() - started)))

    def _ensure_worker(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return
        self._stop.clear()
        self._worker = threading.Thread(target=self._run, daemon=True)
        self._worker.start()

    def stop(self) -> None:
        """Stop scanning. Safe to call more than once."""
        self._stop.set()

    # -- the collect thread only ever reads -----------------------------

    def collect(self) -> dict[str, MetricValue]:
        self._ensure_worker()
        with self._lock:
            cards = [dict(c) for c in self._cards]
        metrics: dict[str, MetricValue] = {}
        if not cards:
            return self._all_unavailable(metrics)

        metrics[self._key("count")] = MetricValue(value=len(cards))
        metrics[self._key("cards")] = MetricValue(
            value=cards, extra={"count": len(cards)})

        first = cards[0]
        for key in _FLAT_KEYS:
            val = first.get(key)
            if val is None:
                metrics[self._key(key)] = MetricValue(available=False)
                continue
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
            metrics[self._key(key)] = MetricValue(
                value=val, unit=_UNITS.get(key, ""), extra=extra)

        metrics[self._key("processes")] = MetricValue(
            value=first.get("processes") or [])
        return metrics

    def _all_unavailable(self, metrics: dict[str, MetricValue]) -> dict[str, MetricValue]:
        for k in _FLAT_KEYS:
            metrics[self._key(k)] = MetricValue(available=False)
        metrics[self._key("processes")] = MetricValue(value=[])
        metrics[self._key("count")] = MetricValue(value=0)
        metrics[self._key("cards")] = MetricValue(value=[], extra={"count": 0})
        return metrics
