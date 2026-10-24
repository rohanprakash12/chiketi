"""Parse chiketi-probe's key=value output. Unknown keys are ignored."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

MAX_LINES = 2000
MAX_GPUS = 16


class ProbeError(ValueError):
    """The text is not chiketi-probe output."""


@dataclass
class Disk:
    dev: str
    model: str = ""
    temp_c: float | None = None
    realloc: int | None = None
    pending: int | None = None
    offline_unc: int | None = None
    health: str = ""


@dataclass
class Gpu:
    """One NVIDIA GPU from a probe's `gpu=` line (v2), or a temperature-only one (v1)."""
    index: int
    name: str = ""
    util: float | None = None
    vram_used: float | None = None
    vram_total: float | None = None
    temp: float | None = None
    power: float | None = None
    power_limit: float | None = None
    fan: float | None = None
    throttle: int | None = None
    bus_id: str = ""
    procs: int | None = None
    detail: bool = True


@dataclass
class ProbeReport:
    version: int
    kind: str = ""
    mem_total_kb: int | None = None
    mem_avail_kb: int | None = None
    filesystems: dict[str, float] = field(default_factory=dict)
    cpu_temp_c: float | None = None
    gpu_temps: list[float] = field(default_factory=list)
    disks: list[Disk] = field(default_factory=list)
    failed_units: list[str] = field(default_factory=list)
    failed_count: int = 0
    sec_updates: int | None = None
    unraid_array: str | None = None
    unraid_disks: dict[str, str] = field(default_factory=dict)
    unraid_parity_errors: int | None = None
    unraid_array_pct: float | None = None   # used space over all array data disks
    gpus: list[Gpu] = field(default_factory=list)
    gpu_tool: str | None = None           # "absent": no nvidia-smi on the host
    gpu_query: str | None = None          # "ok", "fail", or "legacy" for a v1 probe
    gpu_rows: int | None = None           # lines nvidia-smi returned (gpu_query=ok|<n>)
    gpu_procs_query: str | None = None


def _int(s: str) -> int | None:
    try:
        return int(s.strip())
    except ValueError:
        return None


def _float(s: str) -> float | None:
    try:
        v = float(s.strip())
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def _hex(s: str) -> int | None:
    s = s.strip()
    if not s.lower().startswith("0x"):
        return None
    try:
        return int(s, 16)
    except ValueError:
        return None


def _opt(s: str) -> float | None:
    return _float(s) if s.strip() else None


def parse_probe(text: str) -> ProbeReport:
    pairs = []
    for line in text.splitlines()[:MAX_LINES]:
        k, sep, v = line.partition("=")
        if sep:
            pairs.append((k.strip(), v))
    version = next((_int(v) for k, v in pairs if k == "probe_version"), None)
    if not version or version < 1:
        raise ProbeError("no probe_version line")
    r = ProbeReport(version=version)
    procs: dict[str, int] = {}
    for k, v in pairs:
        if k == "kind":
            r.kind = v.strip()
        elif k == "mem_total_kb":
            r.mem_total_kb = _int(v)
        elif k == "mem_avail_kb":
            r.mem_avail_kb = _int(v)
        elif k == "fs":
            mount, _, pct = v.rpartition("|")
            p = _float(pct)
            if mount and p is not None:
                r.filesystems[mount] = p
        elif k == "cpu_temp_c":
            r.cpu_temp_c = _float(v)
        elif k == "gpu_temp_c":
            t = _float(v)
            if t is not None:
                r.gpu_temps.append(t)
        elif k == "disk":
            f = (v.split("|") + [""] * 7)[:7]
            if f[0]:
                r.disks.append(Disk(dev=f[0], model=f[1], temp_c=_float(f[2]) if f[2] else None,
                                    realloc=_int(f[3]) if f[3] else None,
                                    pending=_int(f[4]) if f[4] else None,
                                    offline_unc=_int(f[5]) if f[5] else None,
                                    health=f[6].strip()))
        elif k == "failed_units":
            n, _, names = v.partition("|")
            r.failed_count = _int(n) or 0
            r.failed_units = [x for x in names.split(",") if x]
        elif k == "sec_updates":
            r.sec_updates = _int(v)
        elif k == "unraid_array":
            r.unraid_array = v.strip()
        elif k == "unraid_disk":
            name, _, status = v.partition("|")
            if name:
                r.unraid_disks[name] = status.strip()
        elif k == "unraid_parity_errors":
            r.unraid_parity_errors = _int(v)
        elif k == "unraid_array_pct":
            r.unraid_array_pct = _float(v)
        elif k == "gpu_tool":
            r.gpu_tool = v.strip()
        elif k == "gpu_query":
            q, _, n = v.partition("|")
            r.gpu_query = q.strip()
            if r.gpu_query == "ok":
                r.gpu_rows = _int(n)
        elif k == "gpu_procs_query":
            r.gpu_procs_query = v.partition("|")[0].strip()
        elif k == "gpu_procs":
            bus, _, n = v.partition("|")
            c = _int(n)
            if bus.strip() and c is not None:
                procs[bus.strip().lower()] = c
        elif k == "gpu":
            f = v.split("|")
            idx = _int(f[0]) if len(f) == 11 else None
            if idx is None or idx < 0 or len(r.gpus) >= MAX_GPUS or any(g.index == idx for g in r.gpus):
                continue
            r.gpus.append(Gpu(index=idx, name=f[1].strip()[:40], util=_opt(f[2]), vram_used=_opt(f[3]),
                              vram_total=_opt(f[4]), temp=_opt(f[5]), power=_opt(f[6]),
                              power_limit=_opt(f[7]), fan=_opt(f[8]), throttle=_hex(f[9]),
                              bus_id=f[10].strip()[:32]))
    if r.version >= 2:
        for g in r.gpus:
            g.procs = procs.get(g.bus_id.lower(), 0) if r.gpu_procs_query == "ok" else None
    else:
        # A v1 probe only knows temperatures, in nvidia-smi's order.
        r.gpu_query = "legacy"
        r.gpus = [Gpu(index=i, temp=t, detail=False) for i, t in enumerate(r.gpu_temps[:MAX_GPUS])]
    return r
