"""Background poller: checks every host in parallel, off the metric engine's thread."""

from __future__ import annotations

import math
import os
import random
import sys
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from chiketi.collectors.homelab.checks import (
    CheckError,
    evaluate_gateway,
    evaluate_http,
    fetch_json,
    run_probe,
)
from chiketi.collectors.homelab.config import HomelabConfig, Host
from chiketi.collectors.homelab.probe import ProbeReport
from chiketi.collectors.homelab.rules import (
    HOLD_DOWN,
    Baseline,
    Condition,
    IssueTracker,
    down,
    evaluate_backup,
    evaluate_report,
    gpu_condition,
    gpu_keep_keys,
    gpu_state,
    throttling,
)

_PROBED = ("linux", "unraid")
THR_KEEP, THR_RECENT, THR_QUALIFY = 4, 3, 3     # spec §6.1: last 4; any of 3; 3 of 4


@dataclass
class _ThrHist:
    """One GPU's recent throttle readings, (monotonic poll start, slowed), newest last."""
    ident: str
    readings: deque = field(default_factory=lambda: deque(maxlen=THR_KEEP))
    unresolved: bool = False        # a raised throttling alert not yet shown to be over


def _ident(g) -> str:
    return g.uuid or g.bus_id or g.name


def gpu_outcome(rep: ProbeReport, has_known: bool) -> str:
    """What a host that answered says about its GPUs (spec §2): ok, legacy, none or
    unreadable. Only an explicit gpu_tool=absent (or a v1 probe with no temperatures)
    counts as "no GPU here", and only for a host with no remembered GPUs."""
    if rep.version < 2:
        if rep.gpus:
            return "legacy"
        return "unreadable" if has_known else "none"
    if rep.gpu_tool == "absent":
        return "unreadable" if has_known else "none"
    if rep.gpu_query == "ok" and rep.gpu_rows == len(rep.gpus):
        return "ok"
    return "unreadable"


def _row(host: str, g, state: str, seen_at: float) -> dict:
    return {"host": host, "index": g.index, "name": g.name, "util": g.util, "vram_used": g.vram_used,
            "vram_total": g.vram_total, "temp": g.temp, "power": g.power, "power_limit": g.power_limit,
            "fan": g.fan, "procs": g.procs, "state": state, "detail": g.detail, "seen_at": seen_at}


def baseline_path() -> str:
    base = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return os.path.join(base, "chiketi", "homelab-baseline.json")


class HomelabPoller(threading.Thread):
    daemon = True

    def __init__(self, cfg: HomelabConfig, baseline: Baseline, clock=time.time,
                 probe=run_probe, gateway=evaluate_gateway, http=evaluate_http,
                 fetch=fetch_json, mono=time.monotonic) -> None:
        super().__init__(name="homelab-poller")
        self._cfg, self._baseline, self._clock = cfg, baseline, clock
        self._probe, self._gateway, self._http, self._fetch = probe, gateway, http, fetch
        self._mono = mono
        # Each probed host's last GPU sample (remembered across restarts) and what its
        # last poll said about its GPUs. A remembered host starts as offline, so a
        # restart during an outage still shows its GPUs, with their age.
        self._gpu_mem = baseline.gpu_memory()
        self._gpu_outcome = {h.name: ("offline" if h.name in self._gpu_mem else "pending")
                             for h in cfg.hosts if h.kind in _PROBED}
        self._thr: dict[tuple[str, int], _ThrHist] = {}
        # Throttle evidence older than about four polls never counts (spec §6.1).
        self._age = 4 * (1.1 * cfg.poll_seconds + math.ceil(len(cfg.hosts) / 8) * 40)
        self._tracker = IssueTracker()
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._checked: set[str] = set()
        self._snap: dict = {"hosts": [{"name": h.name, "state": "unknown"} for h in cfg.hosts],
                            "issues": [], "checked_at": None, "poll_seconds": cfg.poll_seconds,
                            "gpus": self._gpu_rows(), "gpu_hosts": self._gpu_hosts(),
                            "published_at": None, "host_count": len(cfg.hosts)}

    def run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.poll_once()
            except Exception as exc:  # noqa: BLE001 - never let the thread die
                print(f"chiketi: homelab poll failed: {exc}", file=sys.stderr)
            self._stop_event.wait(self._cfg.poll_seconds * random.uniform(0.9, 1.1))

    def stop(self) -> None:
        self._stop_event.set()

    def thresholds(self) -> dict:
        return dict(self._cfg.thresholds)

    def _check(self, h: Host, now: float) -> tuple[list[Condition], bool, object]:
        """(conditions, partial, gpu). partial=True leaves the host's other issues as they
        were. gpu: the probe report of a probed host that answered, "offline" if its probe
        failed, "error" if it crashed before a report, None for other kinds. A rule that
        crashes after a good probe still hands back the report: the sample is real."""
        rep = None
        try:
            if h.kind in _PROBED:
                try:
                    rep = self._probe(h, self._cfg)
                except CheckError as exc:
                    return [down(str(exc))], True, "offline"
                conds = evaluate_report(h.name, rep, self._cfg.thresholds, self._baseline, now)
                if h.backup_api:
                    try:
                        conds += evaluate_backup(self._fetch(h.backup_api), self._cfg.thresholds, now)
                    except CheckError as exc:
                        conds.append(Condition("backup_api", "warn", "Backup status unavailable",
                                               str(exc)[:120], HOLD_DOWN))
                return conds, False, rep
            if h.kind == "gateway":
                return self._gateway(h), False, None
            return self._http(h), False, None
        except Exception as exc:  # noqa: BLE001 - a rule bug skips this host for one cycle
            print(f"chiketi: homelab check {h.name} failed: {exc!r}", file=sys.stderr)
            if h.kind not in _PROBED:
                return [], True, None
            return [], True, (rep if rep is not None else "error")

    def _live(self, key: tuple[str, int], at: float | None) -> list[bool] | None:
        """The GPU's unexpired throttle readings at monotonic time `at`, or None."""
        hist = self._thr.get(key)
        if hist is None or at is None:
            return None
        return [b for t, b in hist.readings if at - t <= self._age] or None

    def _drop_thr(self, host: str, keep_index=lambda i: False) -> None:
        for k in [k for k in self._thr if k[0] == host and not keep_index(k[1])]:
            del self._thr[k]

    def _take_gpus(self, h: Host, rep, conds: list[Condition], now: float, start: float, end: float):
        """Record what a probed host said about its GPUs. Returns (conds, keep, decided)
        for the tracker: an unreadable sample is never used, a GPU alert is only cleared
        by a reading that shows it is over, and decided maps each sampled GPU index to
        the throttling decision of this poll (spec §6.3)."""
        if rep in ("offline", "error"):
            self._gpu_outcome[h.name] = "offline" if rep == "offline" else "unreadable"
            return conds, None, {}
        known = self._gpu_mem.get(h.name)
        outcome = gpu_outcome(rep, bool(known and known[0]))
        self._gpu_outcome[h.name] = outcome
        if outcome in ("ok", "legacy"):
            if rep.gpus:
                self._gpu_mem[h.name] = (list(rep.gpus), now)
                self._baseline.remember_gpus(h.name, rep.gpus, now)
            else:
                self._gpu_mem.pop(h.name, None)
                self._baseline.forget_gpus(h.name)
            conds, decided = self._gpu_conditions(h.name, rep, outcome, conds, start, end)
            kk = gpu_keep_keys(rep)
            return conds, (lambda k: k in kk), decided
        if outcome == "none":
            self._gpu_mem.pop(h.name, None)
            self._baseline.forget_gpus(h.name)
            self._drop_thr(h.name)
            return conds, None, {}
        # unreadable: no GPU here has fresh evidence
        return ([c for c in conds if not c.key.startswith("gpu_temp:")],
                (lambda k: k.startswith("gpu_temp:")), {})

    def _gpu_conditions(self, host: str, rep, outcome: str, conds: list[Condition],
                        start: float, end: float) -> tuple[list[Condition], dict[int, bool]]:
        """Update the throttle history from an ok or legacy sample and build the GPU
        conditions from it, replacing evaluate_report's per-sample ones (spec §6.1, §6.3)."""
        present = {g.index for g in rep.gpus}
        self._drop_thr(host, keep_index=lambda i: i in present)
        thr = self._cfg.thresholds
        out = [c for c in conds if not c.key.startswith("gpu_temp:")]
        decided: dict[int, bool] = {}
        for g in rep.gpus:
            key = (host, g.index)
            hist = self._thr.get(key)
            if outcome == "ok":
                if hist is None or hist.ident != _ident(g):
                    hist = self._thr[key] = _ThrHist(_ident(g))
                if g.throttle is not None:
                    hist.readings.append((start, throttling(g)))
            elif hist is not None:
                hist.readings.clear()             # a v1 sample says nothing about throttling
            can_show = outcome == "ok" and g.throttle is not None
            if hist is not None and hist.unresolved and not can_show:
                throttled = fast = True
            elif outcome == "legacy":
                throttled = fast = False
            else:
                live = self._live(key, end) or []
                qualifies = sum(live[-THR_KEEP:]) >= THR_QUALIFY
                recent = any(live[-THR_RECENT:])
                raised = self._tracker.raised(host, f"gpu_temp:{g.index}") is not None
                throttled = fast = qualifies or (raised and recent)
            decided[g.index] = throttled
            c = gpu_condition(g, thr, throttled, fast)
            if c is not None:
                out.append(c)
        return out, decided

    def _gpu_hosts(self) -> list[dict]:
        return [{"host": n, "outcome": o} for n, o in self._gpu_outcome.items()]

    def _gpu_rows(self, at: float | None = None) -> list[dict]:
        """The GPU rows, with throttle evidence judged at monotonic time `at`."""
        thr = self._cfg.thresholds
        rows = []
        for h in self._cfg.hosts:
            mem = self._gpu_mem.get(h.name)
            if h.kind not in _PROBED or not mem:
                continue
            outcome = self._gpu_outcome[h.name]
            as_of = "offline" if outcome == "pending" else outcome
            for g in sorted(mem[0], key=lambda g: g.index):
                live = self._live((h.name, g.index), at)
                recent = any(live[-THR_RECENT:]) if live else None
                rows.append(_row(h.name, g, gpu_state(g, thr, as_of, recent), mem[1]))
        return rows

    def poll_once(self) -> None:
        now = self._clock()
        start = self._mono()
        hosts = self._cfg.hosts
        with ThreadPoolExecutor(max_workers=min(8, len(hosts))) as ex:
            results = list(ex.map(lambda h: self._check(h, now), hosts))
        # One instant for judging throttle evidence, before any result is used (§6.1).
        end = self._mono()
        for h, (conds, partial, gpu) in zip(hosts, results, strict=True):
            keep, decided = None, {}
            if h.kind in _PROBED and gpu is not None:
                conds, keep, decided = self._take_gpus(h, gpu, conds, now, start, end)
            self._tracker.update(h.name, conds, now, partial, keep=keep)
            for i, throttled in decided.items():
                hist, key = self._thr.get((h.name, i)), f"gpu_temp:{i}"
                if hist is None:
                    continue
                if throttled and self._tracker.raised(h.name, key):
                    hist.unresolved = True
                if not self._tracker.holds(h.name, key):
                    hist.unresolved = False
            if conds or not partial:
                self._checked.add(h.name)
        try:
            self._baseline.save()
        except OSError as exc:
            print(f"chiketi: homelab baseline not saved: {exc}", file=sys.stderr)
        snap = {
            "hosts": [{"name": h.name,
                       "state": self._tracker.host_state(h.name) if h.name in self._checked else "unknown"}
                      for h in hosts],
            "issues": self._tracker.issues(),
            "checked_at": now,
            "poll_seconds": self._cfg.poll_seconds,
            "gpus": self._gpu_rows(end),
            "gpu_hosts": self._gpu_hosts(),
            # When the checks FINISHED (checked_at is when they started): GPU freshness
            # is judged on this, so a stalled poller goes stale.
            "published_at": now + (end - start),
            "host_count": len(hosts),
        }
        with self._lock:
            self._snap = snap

    def snapshot(self) -> dict:
        with self._lock:
            return self._snap
