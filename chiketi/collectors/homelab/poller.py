"""Background poller: checks every host in parallel, off the metric engine's thread."""

from __future__ import annotations

import os
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

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
    gpu_keep_keys,
    gpu_state,
)

_PROBED = ("linux", "unraid")


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
        failed, None otherwise (and for a crashing rule: GPU state is left as it was)."""
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
            return [], True, None

    def _take_gpus(self, h: Host, rep, conds: list[Condition], now: float):
        """Record what a probed host said about its GPUs. Returns (conds, keep) for the
        tracker: an unreadable sample is never used, and a GPU alert is only cleared by
        a reading that shows it is over."""
        if rep == "offline":
            self._gpu_outcome[h.name] = "offline"
            return conds, None
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
            kk = gpu_keep_keys(rep)
            return conds, (lambda k: k in kk)
        if outcome == "none":
            self._gpu_mem.pop(h.name, None)
            self._baseline.forget_gpus(h.name)
            return conds, None
        # unreadable: no GPU here has fresh evidence
        return ([c for c in conds if not c.key.startswith("gpu_temp:")],
                (lambda k: k.startswith("gpu_temp:")))

    def _gpu_hosts(self) -> list[dict]:
        return [{"host": n, "outcome": o} for n, o in self._gpu_outcome.items()]

    def _gpu_rows(self) -> list[dict]:
        thr = self._cfg.thresholds
        rows = []
        for h in self._cfg.hosts:
            mem = self._gpu_mem.get(h.name)
            if h.kind not in _PROBED or not mem:
                continue
            outcome = self._gpu_outcome[h.name]
            as_of = "offline" if outcome == "pending" else outcome
            for g in sorted(mem[0], key=lambda g: g.index):
                rows.append(_row(h.name, g, gpu_state(g, thr, as_of), mem[1]))
        return rows

    def poll_once(self) -> None:
        now = self._clock()
        start = self._mono()
        hosts = self._cfg.hosts
        with ThreadPoolExecutor(max_workers=min(8, len(hosts))) as ex:
            results = list(ex.map(lambda h: self._check(h, now), hosts))
        for h, (conds, partial, gpu) in zip(hosts, results, strict=True):
            keep = None
            if h.kind in _PROBED and gpu is not None:
                conds, keep = self._take_gpus(h, gpu, conds, now)
            self._tracker.update(h.name, conds, now, partial, keep=keep)
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
            "gpus": self._gpu_rows(),
            "gpu_hosts": self._gpu_hosts(),
            # When the poll FINISHED (checked_at is when it started): GPU freshness is
            # judged on this, so a stalled poller goes stale.
            "published_at": now + (self._mono() - start),
            "host_count": len(hosts),
        }
        with self._lock:
            self._snap = snap

    def snapshot(self) -> dict:
        with self._lock:
            return self._snap
