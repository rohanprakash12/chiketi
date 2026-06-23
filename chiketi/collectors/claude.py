"""Claude Code usage stats collector — reads session JSONL files."""

from __future__ import annotations

import glob
import json
import os
import time
from collections import deque
from datetime import datetime

from chiketi.collectors.base import MetricCollector, MetricValue

_CLAUDE_DIR = os.path.expanduser("~/.claude")
_PROJECTS_DIR = os.path.join(_CLAUDE_DIR, "projects")


class ClaudeCollector(MetricCollector):
    """Collects Claude Code usage metrics from local session files."""

    namespace = "claude"

    def __init__(self) -> None:
        super().__init__()
        # All-time cache (refreshed every 60s)
        self._alltime_cache: dict | None = None
        self._alltime_ts: float = 0.0
        # Per-file scan cache: path -> {"sig": (mtime, size), "stats": {...}}.
        # Unchanged files are skipped on re-scan instead of re-read in full.
        self._file_cache: dict[str, dict] = {}
        # Current session tracking
        self._session_file: str = ""
        self._session_pos: int = 0  # file position for incremental reads
        self._session_stats: dict = {
            "input": 0, "output": 0, "cache_write": 0, "cache_read": 0,
            "msgs_user": 0, "msgs_assistant": 0, "agents": set(),
        }
        # Token rate tracking (rolling window)
        self._rate_samples: deque = deque(maxlen=30)
        self._prev_total: int = 0
        self._prev_time: float = 0.0

    def collect(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}
        now = time.monotonic()

        # All-time stats (refresh every 60s)
        if self._alltime_cache is None or (now - self._alltime_ts) > 60:
            self._alltime_cache = self._scan_all_sessions()
            self._alltime_ts = now
        at = self._alltime_cache

        # Current session (incremental)
        self._update_current_session()
        cs = self._session_stats

        # Token rate
        session_total = cs["input"] + cs["output"] + cs["cache_write"] + cs["cache_read"]
        if self._prev_time > 0:
            dt = now - self._prev_time
            if dt > 0.5:
                delta = session_total - self._prev_total
                rate = (delta / dt) * 60  # tokens per minute
                self._rate_samples.append(rate)
        self._prev_total = session_total
        self._prev_time = now

        # --- All-time metrics ---
        metrics[self._key("tokens_input")] = MetricValue(value=at["input"])
        metrics[self._key("tokens_output")] = MetricValue(value=at["output"])
        metrics[self._key("tokens_cache_write")] = MetricValue(value=at["cache_write"])
        metrics[self._key("tokens_cache_read")] = MetricValue(value=at["cache_read"])
        total = at["input"] + at["output"] + at["cache_write"] + at["cache_read"]
        metrics[self._key("tokens_total")] = MetricValue(value=total)

        metrics[self._key("msgs_user")] = MetricValue(value=at["msgs_user"])
        metrics[self._key("msgs_assistant")] = MetricValue(value=at["msgs_assistant"])
        metrics[self._key("msgs_total")] = MetricValue(
            value=at["msgs_user"] + at["msgs_assistant"]
        )

        # Monthly averages
        days = max(1, at["days_active"])
        months = max(1.0, days / 30.0)
        metrics[self._key("monthly_tokens")] = MetricValue(value=round(total / months))
        metrics[self._key("monthly_messages")] = MetricValue(
            value=round((at["msgs_user"] + at["msgs_assistant"]) / months)
        )
        metrics[self._key("days_active")] = MetricValue(value=days)
        metrics[self._key("sessions")] = MetricValue(value=at["session_count"])

        # --- Current session metrics ---
        metrics[self._key("session_input")] = MetricValue(value=cs["input"])
        metrics[self._key("session_output")] = MetricValue(value=cs["output"])
        metrics[self._key("session_cache_write")] = MetricValue(value=cs["cache_write"])
        metrics[self._key("session_cache_read")] = MetricValue(value=cs["cache_read"])
        metrics[self._key("session_total")] = MetricValue(value=session_total)
        metrics[self._key("session_msgs")] = MetricValue(
            value=cs["msgs_user"] + cs["msgs_assistant"]
        )

        # Agents
        metrics[self._key("agents_active")] = MetricValue(value=len(cs["agents"]))

        # Token rate (tok/min) and sparkline data
        current_rate = self._rate_samples[-1] if self._rate_samples else 0
        metrics[self._key("token_rate")] = MetricValue(
            value=round(current_rate), unit="tok/min"
        )
        metrics[self._key("sparkline")] = MetricValue(
            value=list(self._rate_samples)
        )

        return metrics

    def _scan_all_sessions(self) -> dict:
        """Aggregate stats across all JSONL session files.

        Each file is scanned only when its (mtime, size) signature changes;
        unchanged files are served from the per-file cache. This keeps the 60s
        refresh cheap even with a large session history, since typically only
        the active session file has grown.
        """
        seen: set[str] = set()
        for project_dir in glob.glob(os.path.join(_PROJECTS_DIR, "*")):
            for fpath in glob.glob(os.path.join(project_dir, "*.jsonl")):
                seen.add(fpath)
                try:
                    st = os.stat(fpath)
                except OSError:
                    continue
                sig = (st.st_mtime, st.st_size)
                cached = self._file_cache.get(fpath)
                if cached and cached["sig"] == sig:
                    continue  # unchanged since last scan
                stats = {
                    "input": 0, "output": 0, "cache_write": 0, "cache_read": 0,
                    "msgs_user": 0, "msgs_assistant": 0,
                    "earliest": None, "latest": None,
                }
                try:
                    self._scan_file(fpath, stats)
                except Exception:
                    pass
                self._file_cache[fpath] = {"sig": sig, "stats": stats}

        # Drop cache entries for files that no longer exist.
        for gone in set(self._file_cache) - seen:
            del self._file_cache[gone]

        # Aggregate per-file stats into grand totals.
        totals = {
            "input": 0, "output": 0, "cache_write": 0, "cache_read": 0,
            "msgs_user": 0, "msgs_assistant": 0,
            "earliest": None, "latest": None,
            "session_count": 0,
        }
        for entry in self._file_cache.values():
            s = entry["stats"]
            for k in ("input", "output", "cache_write", "cache_read",
                      "msgs_user", "msgs_assistant"):
                totals[k] += s[k]
            totals["session_count"] += 1
            if s["earliest"] and (totals["earliest"] is None
                                  or s["earliest"] < totals["earliest"]):
                totals["earliest"] = s["earliest"]
            if s["latest"] and (totals["latest"] is None
                                or s["latest"] > totals["latest"]):
                totals["latest"] = s["latest"]

        # Calculate days active
        if totals["earliest"] and totals["latest"]:
            delta = totals["latest"] - totals["earliest"]
            totals["days_active"] = max(1, delta.days)
        else:
            totals["days_active"] = 1

        return totals

    def _scan_file(self, fpath: str, totals: dict) -> None:
        """Scan a single JSONL file and accumulate into totals."""
        with open(fpath) as f:
            for line in f:
                try:
                    obj = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue

                msg_type = obj.get("type")

                # Track timestamps
                ts_str = obj.get("timestamp")
                if ts_str:
                    try:
                        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                        if totals["earliest"] is None or ts < totals["earliest"]:
                            totals["earliest"] = ts
                        if totals["latest"] is None or ts > totals["latest"]:
                            totals["latest"] = ts
                    except (ValueError, TypeError):
                        pass

                if msg_type == "assistant":
                    totals["msgs_assistant"] += 1
                    usage = (obj.get("message") or {}).get("usage") or {}
                    totals["input"] += usage.get("input_tokens", 0)
                    totals["output"] += usage.get("output_tokens", 0)
                    totals["cache_write"] += usage.get("cache_creation_input_tokens", 0)
                    totals["cache_read"] += usage.get("cache_read_input_tokens", 0)
                elif msg_type == "user":
                    totals["msgs_user"] += 1

    def _update_current_session(self) -> None:
        """Incrementally read the current (latest) session file."""
        # Find latest session file
        all_files = []
        for project_dir in glob.glob(os.path.join(_PROJECTS_DIR, "*")):
            all_files.extend(glob.glob(os.path.join(project_dir, "*.jsonl")))
        if not all_files:
            return

        latest = max(all_files, key=os.path.getmtime)

        # If session file changed, reset
        if latest != self._session_file:
            self._session_file = latest
            self._session_pos = 0
            self._session_stats = {
                "input": 0, "output": 0, "cache_write": 0, "cache_read": 0,
                "msgs_user": 0, "msgs_assistant": 0, "agents": set(),
            }

        # Read new lines from current position
        try:
            with open(self._session_file) as f:
                f.seek(self._session_pos)
                for line in f:
                    try:
                        obj = json.loads(line)
                    except (json.JSONDecodeError, ValueError):
                        continue

                    msg_type = obj.get("type")
                    if msg_type == "assistant":
                        self._session_stats["msgs_assistant"] += 1
                        usage = (obj.get("message") or {}).get("usage") or {}
                        self._session_stats["input"] += usage.get("input_tokens", 0)
                        self._session_stats["output"] += usage.get("output_tokens", 0)
                        self._session_stats["cache_write"] += usage.get(
                            "cache_creation_input_tokens", 0
                        )
                        self._session_stats["cache_read"] += usage.get(
                            "cache_read_input_tokens", 0
                        )
                    elif msg_type == "user":
                        self._session_stats["msgs_user"] += 1
                    elif msg_type == "progress":
                        data = obj.get("data") or {}
                        if data.get("type") == "agent_progress":
                            aid = data.get("agentId", "")
                            if aid:
                                self._session_stats["agents"].add(aid)

                self._session_pos = f.tell()
        except Exception:
            pass
