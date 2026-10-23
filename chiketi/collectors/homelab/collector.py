"""HomelabCollector: exposes the poller's latest snapshot as homelab.* metrics."""

from __future__ import annotations

import sys

from chiketi.collectors.base import MetricCollector, MetricValue
from chiketi.collectors.homelab.config import ConfigError, default_path, load_config
from chiketi.collectors.homelab.poller import HomelabPoller, baseline_path
from chiketi.collectors.homelab.rules import Baseline


class HomelabCollector(MetricCollector):
    namespace = "homelab"

    def __init__(self, path: str | None = None, start: bool = True) -> None:
        self._poller: HomelabPoller | None = None
        path = path or default_path()
        try:
            cfg = load_config(path)
        except FileNotFoundError:
            return
        except ConfigError as exc:
            print(f"chiketi: homelab disabled, {exc}", file=sys.stderr)
            return
        self._poller = HomelabPoller(cfg, Baseline(baseline_path()))
        if start:
            self._poller.start()

    def collect(self) -> dict[str, MetricValue]:
        if self._poller is None:
            return {self._key("status"): MetricValue("unconfigured")}
        snap = self._poller.snapshot()
        issues = snap["issues"]
        if snap["checked_at"] is None:
            status = "pending"
        elif any(i["severity"] == "crit" for i in issues):
            status = "crit"
        elif issues:
            status = "warn"
        else:
            status = "ok"
        return {
            self._key("status"): MetricValue(status),
            self._key("hosts"): MetricValue(snap["hosts"]),
            self._key("issues"): MetricValue(issues),
            self._key("checked_at"): MetricValue(snap["checked_at"], "s",
                                                 available=snap["checked_at"] is not None,
                                                 extra={"poll_seconds": snap["poll_seconds"]}),
        }
