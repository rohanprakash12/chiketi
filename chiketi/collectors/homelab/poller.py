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
from chiketi.collectors.homelab.rules import (
    HOLD_DOWN,
    Baseline,
    Condition,
    IssueTracker,
    down,
    evaluate_backup,
    evaluate_report,
)


def baseline_path() -> str:
    base = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return os.path.join(base, "chiketi", "homelab-baseline.json")


class HomelabPoller(threading.Thread):
    daemon = True

    def __init__(self, cfg: HomelabConfig, baseline: Baseline, clock=time.time,
                 probe=run_probe, gateway=evaluate_gateway, http=evaluate_http,
                 fetch=fetch_json) -> None:
        super().__init__(name="homelab-poller")
        self._cfg, self._baseline, self._clock = cfg, baseline, clock
        self._probe, self._gateway, self._http, self._fetch = probe, gateway, http, fetch
        self._tracker = IssueTracker()
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._checked: set[str] = set()
        self._snap: dict = {"hosts": [{"name": h.name, "state": "unknown"} for h in cfg.hosts],
                            "issues": [], "checked_at": None, "poll_seconds": cfg.poll_seconds}

    def run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.poll_once()
            except Exception as exc:  # noqa: BLE001 - never let the thread die
                print(f"chiketi: homelab poll failed: {exc}", file=sys.stderr)
            self._stop_event.wait(self._cfg.poll_seconds * random.uniform(0.9, 1.1))

    def stop(self) -> None:
        self._stop_event.set()

    def _check(self, h: Host, now: float) -> tuple[list[Condition], bool]:
        """(conditions, partial). partial=True leaves the host's other issues as they were."""
        try:
            if h.kind in ("linux", "unraid"):
                try:
                    rep = self._probe(h, self._cfg)
                except CheckError as exc:
                    return [down(str(exc))], True
                conds = evaluate_report(h.name, rep, self._cfg.thresholds, self._baseline, now)
                if h.backup_api:
                    try:
                        conds += evaluate_backup(self._fetch(h.backup_api), self._cfg.thresholds, now)
                    except CheckError as exc:
                        conds.append(Condition("backup_api", "warn", "Backup status unavailable",
                                               str(exc)[:120], HOLD_DOWN))
                return conds, False
            if h.kind == "gateway":
                return self._gateway(h), False
            return self._http(h), False
        except Exception as exc:  # noqa: BLE001 - a rule bug skips this host for one cycle
            print(f"chiketi: homelab check {h.name} failed: {exc!r}", file=sys.stderr)
            return [], True

    def poll_once(self) -> None:
        now = self._clock()
        hosts = self._cfg.hosts
        with ThreadPoolExecutor(max_workers=min(8, len(hosts))) as ex:
            results = list(ex.map(lambda h: self._check(h, now), hosts))
        for h, (conds, partial) in zip(hosts, results):
            self._tracker.update(h.name, conds, now, partial)
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
        }
        with self._lock:
            self._snap = snap

    def snapshot(self) -> dict:
        with self._lock:
            return self._snap
