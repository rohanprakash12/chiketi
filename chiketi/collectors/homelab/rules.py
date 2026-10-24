"""Turn probe reports into issues: thresholds, hold/clear, and baselines."""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
import threading
from dataclasses import asdict, dataclass, fields
from datetime import datetime

from chiketi.collectors.homelab.probe import MAX_GPUS, Disk, Gpu, ProbeReport

HOLD_NOW, HOLD_FS, HOLD_UNITS, HOLD_TEMP, HOLD_DOWN, HOLD_MEM = 1, 2, 2, 4, 4, 10
CLEAR_AFTER = 2
UNRAID_OK = {"DISK_OK", "DISK_NP", "DISK_NP_DSBL"}   # NP = empty slot, normal


@dataclass(frozen=True)
class Condition:
    key: str
    severity: str
    title: str
    detail: str
    hold: int


def _cut(s: str, n: int) -> str:
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def down(detail: str) -> Condition:
    return Condition("down", "crit", "Unreachable", _cut(detail, 120), HOLD_DOWN)


def _level(value: float, warn: float, crit: float, below: bool = False) -> str | None:
    if below:
        return "crit" if value < crit else "warn" if value < warn else None
    return "crit" if value >= crit else "warn" if value >= warn else None


class Baseline:
    """SMART counters seen first, and when security updates first appeared.

    Old non-zero SMART counts are common and harmless; only a RISE matters.
    Persisted so a chiketi restart does not forget what was normal."""

    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._dirty = False
        self._data: dict = {"smart": {}, "sec": {}, "gpus": {}}
        try:
            with open(path) as f:
                raw = json.load(f)
            if isinstance(raw.get("smart"), dict) and isinstance(raw.get("sec"), dict):
                self._data = raw
        except (OSError, ValueError, AttributeError):
            pass
        if not isinstance(self._data.get("gpus"), dict):
            self._data["gpus"] = {}

    def smart_rises(self, host: str, disk: Disk) -> list[tuple[str, int, int]]:
        key = f"{host}|{disk.dev}|{disk.model}"
        rose = []
        with self._lock:
            base = self._data["smart"].setdefault(key, {})
            for name in ("realloc", "pending", "offline_unc"):
                v = getattr(disk, name)
                if v is None:
                    continue
                if name not in base:
                    base[name] = v
                    self._dirty = True
                elif v > base[name]:
                    rose.append((name, base[name], v))
        return rose

    def sec_pending_since(self, host: str, count: int | None, now: float) -> float | None:
        with self._lock:
            if not count:
                if self._data["sec"].pop(host, None) is not None:
                    self._dirty = True
                return None
            if host not in self._data["sec"]:
                self._data["sec"][host] = now
                self._dirty = True
            return float(self._data["sec"][host])

    def gpu_memory(self) -> dict[str, tuple[list[Gpu], float]]:
        """Each host's last GPU sample and when it was taken, as remembered across restarts.
        A record that is malformed in any way is dropped whole."""
        out: dict[str, tuple[list[Gpu], float]] = {}
        with self._lock:
            for host, rec in self._data["gpus"].items():
                gpus = _gpus_from_json(rec)
                if gpus is not None:
                    out[host] = (gpus, float(rec["seen_at"]))
        return out

    def remember_gpus(self, host: str, gpus: list[Gpu], seen_at: float) -> None:
        with self._lock:
            self._data["gpus"][host] = {"seen_at": seen_at, "gpus": [asdict(g) for g in gpus]}
            self._dirty = True

    def forget_gpus(self, host: str) -> None:
        with self._lock:
            if self._data["gpus"].pop(host, None) is not None:
                self._dirty = True

    def save(self) -> None:
        with self._lock:
            if not self._dirty:
                return
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path) or ".", suffix=".tmp")
            with os.fdopen(fd, "w") as f:
                json.dump(self._data, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
            self._dirty = False


_GPU_FLOATS = ("util", "vram_used", "vram_total", "temp", "power", "power_limit", "fan")


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _gpus_from_json(rec) -> list[Gpu] | None:
    if not isinstance(rec, dict) or not _finite(rec.get("seen_at")):
        return None
    raw = rec.get("gpus")
    if not isinstance(raw, list) or len(raw) > MAX_GPUS:
        return None
    names = {f.name for f in fields(Gpu)}
    out = []
    for g in raw:
        if not isinstance(g, dict):
            return None
        idx = g.get("index")
        if not isinstance(idx, int) or isinstance(idx, bool) or idx < 0:
            return None
        if any(g.get(k) is not None and not _finite(g.get(k)) for k in _GPU_FLOATS):
            return None
        if not isinstance(g.get("name", ""), str) or not isinstance(g.get("bus_id", ""), str):
            return None
        for k in ("throttle", "procs"):
            v = g.get(k)
            if v is not None and (not isinstance(v, int) or isinstance(v, bool)):
                return None
        if not isinstance(g.get("detail", True), bool):
            return None
        out.append(Gpu(**{k: v for k, v in g.items() if k in names}))
    return out


THROTTLE_BITS = 0x08 | 0x20 | 0x40 | 0x80   # HW slowdown, SW thermal, HW thermal, HW power brake


def throttling(g: Gpu) -> bool:
    """A thermal or hardware slowdown. The 0x04 software power cap under load is normal."""
    return g.throttle is not None and bool(g.throttle & THROTTLE_BITS)


def gpu_state(g: Gpu, thr: dict, outcome: str) -> str:
    """The one-word state of a GPU (spec decision 3); the first match wins."""
    if outcome in ("offline", "unreadable"):
        return outcome
    if g.temp is not None and g.temp >= thr["gpu_crit_c"]:
        return "critical"
    if g.temp is not None and g.temp >= thr["gpu_warn_c"]:
        return "hot"
    if throttling(g):
        return "throttling"
    if not g.detail:
        return "nodetail"
    if (g.util is not None and g.util >= 10) or (g.procs is not None and g.procs >= 1):
        return "busy"
    if g.util is not None and g.procs == 0:
        return "idle"
    return "unknown"


def gpu_condition(g: Gpu, thr: dict) -> Condition | None:
    """One condition per GPU, from heat or throttling: a change between the two keeps the
    same key, so a raised alert never drops in the handover."""
    key = f"gpu_temp:{g.index}"
    if g.temp is not None:
        sev = _level(g.temp, thr["gpu_warn_c"], thr["gpu_crit_c"])
        if sev:
            return Condition(key, sev, f"GPU {g.index} {g.temp:.0f}°C", "", HOLD_TEMP)
    if throttling(g):
        return Condition(key, "warn", f"GPU {g.index} throttling", "clock slowdown reported by the driver", HOLD_TEMP)
    return None


def gpu_keep_keys(rep: ProbeReport) -> set[str]:
    """GPUs whose reading cannot show an alert is over: no temperature, or (v2) no throttle mask."""
    return {f"gpu_temp:{g.index}" for g in rep.gpus
            if g.temp is None or (g.detail and g.throttle is None)}


_ARRAY_DISK = re.compile(r"^/mnt/disk[0-9]+$")
_SMART_NAMES = {"realloc": "reallocated", "pending": "pending", "offline_unc": "uncorrectable"}


def evaluate_report(host: str, rep: ProbeReport, thr: dict, baseline: Baseline,
                    now: float) -> list[Condition]:
    out: list[Condition] = []
    unraid = rep.kind == "unraid"
    for mount, pct in rep.filesystems.items():
        # Unraid fills its data disks one after another, so a full array disk
        # is normal: the array is judged as a whole below.
        if unraid and _ARRAY_DISK.match(mount):
            continue
        sev = _level(pct, thr["fs_warn_pct"], thr["fs_crit_pct"])
        if sev:
            out.append(Condition(f"fs:{_cut(mount, 80)}", sev, f"{_cut(mount, 40)} {pct:.0f}% full",
                                 "filesystem space", HOLD_FS))
    if unraid and rep.unraid_array_pct is not None:
        sev = _level(rep.unraid_array_pct, thr["fs_warn_pct"], thr["fs_crit_pct"])
        if sev:
            out.append(Condition("fs:array", sev, f"Array {rep.unraid_array_pct:.0f}% full",
                                 "Unraid array space", HOLD_FS))
    if rep.mem_total_kb and rep.mem_avail_kb is not None:
        avail = 100.0 * rep.mem_avail_kb / rep.mem_total_kb
        sev = _level(avail, thr["mem_warn_pct"], thr["mem_crit_pct"], below=True)
        if sev:
            out.append(Condition("mem", sev, f"Memory {avail:.0f}% available",
                                 f"{rep.mem_avail_kb // 1024} MiB free of {rep.mem_total_kb // 1024} MiB",
                                 HOLD_MEM))
    if rep.cpu_temp_c is not None:
        sev = _level(rep.cpu_temp_c, thr["cpu_warn_c"], thr["cpu_crit_c"])
        if sev:
            out.append(Condition("cpu_temp", sev, f"CPU {rep.cpu_temp_c:.0f}°C", "package temperature", HOLD_TEMP))
    for g in rep.gpus:
        c = gpu_condition(g, thr)
        if c:
            out.append(c)
    for d in rep.disks:
        dev = _cut(d.dev, 16)
        if d.health and d.health.upper().rstrip("!") not in ("PASSED", "OK"):
            out.append(Condition(f"smart:{dev}", "crit", f"Disk {dev} SMART {_cut(d.health, 12)}",
                                 _cut(d.model, 60), HOLD_NOW))
        else:
            rises = baseline.smart_rises(host, d)
            if rises:
                what = ", ".join(f"{_SMART_NAMES[n]} {a}→{b}" for n, a, b in rises)
                out.append(Condition(f"smart:{dev}", "warn", f"Disk {dev}: {what}", _cut(d.model, 60), HOLD_NOW))
        if d.temp_c is not None:
            sev = _level(d.temp_c, thr["disk_warn_c"], thr["disk_crit_c"])
            if sev:
                out.append(Condition(f"disk_temp:{dev}", sev, f"Disk {dev} {d.temp_c:.0f}°C",
                                     _cut(d.model, 60), HOLD_TEMP))
    if rep.failed_count > 0:
        n = rep.failed_count
        out.append(Condition("units", "warn", f"{n} failed service{'s' if n != 1 else ''}",
                             _cut(", ".join(rep.failed_units[:3]), 120), HOLD_UNITS))
    since = baseline.sec_pending_since(host, rep.sec_updates, now)
    if since is not None and now - since >= thr["sec_updates_days"] * 86400:
        days = int((now - since) // 86400)
        out.append(Condition("sec_updates", "warn", f"{rep.sec_updates} security updates pending",
                             f"for {days} days", HOLD_NOW))
    if rep.kind == "unraid":
        if rep.unraid_array and rep.unraid_array.upper() != "STARTED":
            out.append(Condition("unraid_array", "crit", f"Array {_cut(rep.unraid_array, 16).lower()}", "", HOLD_NOW))
        for name, status in rep.unraid_disks.items():
            if status and status not in UNRAID_OK:
                out.append(Condition(f"unraid_disk:{_cut(name, 16)}", "crit",
                                     f"{_cut(name, 16)} {_cut(status, 20)}", "Unraid disk status", HOLD_NOW))
        if rep.unraid_parity_errors:
            out.append(Condition("unraid_parity", "warn", f"Parity check: {rep.unraid_parity_errors} errors",
                                 "last parity check", HOLD_NOW))
    return out


def _last_exit(events: object) -> float | None:
    for line in reversed(str(events or "").splitlines()):
        if " EXIT " in line:
            try:
                return datetime.fromisoformat(line.split()[0]).timestamp()
            except ValueError:
                return None
    return None


def evaluate_backup(data: dict, thr: dict, now: float) -> list[Condition]:
    out: list[Condition] = []
    if data.get("active"):
        return out
    code = data.get("exit")
    if isinstance(code, int) and not isinstance(code, bool) and code != 0:
        out.append(Condition("backup_failed", "crit", "Backup failed", f"exit code {code}", HOLD_NOW))
    max_h = thr.get("backup_max_age_h", 0.0)
    if max_h > 0:
        fin = _last_exit(data.get("events"))
        if fin is None or now - fin > max_h * 3600:
            ago = "never" if fin is None else f"{int((now - fin) // 3600)} h ago"
            out.append(Condition("backup_age", "warn", "Backup overdue", f"last finished {ago}", HOLD_NOW))
    return out


@dataclass
class _Track:
    cond: Condition
    since: float
    bad: int = 0
    good: int = 0
    raised: bool = False


class IssueTracker:
    """Raise a condition only after `hold` bad checks in a row; clear it after
    CLEAR_AFTER good ones. partial=True (host unreachable) leaves every key the
    update does not mention exactly as it was."""

    def __init__(self) -> None:
        self._t: dict[tuple[str, str], _Track] = {}

    def update(self, host: str, conds: list[Condition], now: float, partial: bool = False,
               keep=None) -> None:
        """keep: a predicate on keys; a key it accepts that this update does not mention
        is left as it was (no evidence either way), as for a partial update."""
        seen = set()
        for c in conds:
            k = (host, c.key)
            seen.add(k)
            t = self._t.get(k)
            if t is None:
                t = self._t[k] = _Track(cond=c, since=now)
            t.cond, t.bad, t.good = c, t.bad + 1, 0
            if t.bad >= c.hold:
                t.raised = True
        if partial:
            return
        for k in [k for k in self._t if k[0] == host and k not in seen]:
            if keep is not None and keep(k[1]):
                continue
            t = self._t[k]
            t.good, t.bad = t.good + 1, 0
            if not t.raised or t.good >= CLEAR_AFTER:
                del self._t[k]

    def issues(self) -> list[dict]:
        out = [{"host": h, "severity": t.cond.severity, "title": t.cond.title,
                "detail": t.cond.detail, "since": t.since}
               for (h, _k), t in self._t.items() if t.raised]
        out.sort(key=lambda i: (0 if i["severity"] == "crit" else 1, i["since"]))
        return out

    def host_state(self, host: str) -> str:
        sev = {t.cond.severity for (h, _k), t in self._t.items() if h == host and t.raised}
        return "crit" if "crit" in sev else "warn" if "warn" in sev else "ok"
