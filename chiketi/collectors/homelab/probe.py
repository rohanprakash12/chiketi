"""Parse chiketi-probe's key=value output. Unknown keys are ignored."""

from __future__ import annotations

from dataclasses import dataclass, field

MAX_LINES = 2000


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


def _int(s: str) -> int | None:
    try:
        return int(s.strip())
    except ValueError:
        return None


def _float(s: str) -> float | None:
    try:
        return float(s.strip())
    except ValueError:
        return None


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
    return r
