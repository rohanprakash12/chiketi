"""Claude Code usage stats collector — reads session JSONL files."""

from __future__ import annotations

import glob
import json
import os
import time
from collections import deque
from datetime import datetime, timezone

from chiketi.collectors.base import MetricCollector, MetricValue

_CLAUDE_DIR = os.path.expanduser("~/.claude")
_PROJECTS_DIR = os.path.join(_CLAUDE_DIR, "projects")


_TOKEN_FIELDS = (
    ("input", "input_tokens"),
    ("output", "output_tokens"),
    ("cache_write", "cache_creation_input_tokens"),
    ("cache_read", "cache_read_input_tokens"),
)


def _usage_tokens(obj: dict) -> dict[str, int]:
    """Pull the four token counts out of a record, tolerating any shape.

    Session files are written by another process and are not a schema we
    control: `message` may be a string, `usage` may be a number, and a count
    may be a string or null. Every one of those raises on the naive
    `(obj.get("message") or {}).get("usage")` + `+=` path, and because
    _scan_file's result is cached against (mtime, size), a single bad record
    used to abandon the rest of the file and cache the partial total forever.

    Shared by both readers on purpose: the all-time scanner and the
    incremental session reader drifted apart three times during this audit.
    """
    message = obj.get("message")
    usage = message.get("usage") if isinstance(message, dict) else None
    if not isinstance(usage, dict):
        usage = {}
    out: dict[str, int] = {}
    for key, field in _TOKEN_FIELDS:
        value = usage.get(field, 0)
        out[key] = value if isinstance(value, int) and not isinstance(value, bool) else 0
    return out


def _parse_timestamp(raw) -> datetime | None:
    """Parse a record timestamp as timezone-aware UTC, or None.

    Normalising here rather than at comparison time is deliberate. A naive but
    otherwise valid ISO timestamp parses fine, gets cached in that file's
    stats, and then explodes in _scan_all_sessions' cross-file min/max with
    "can't compare offset-naive and offset-aware datetimes" -- outside every
    per-record guard, on every cycle, with the poison value served from cache
    forever. Anything without an offset is treated as UTC.
    """
    if not isinstance(raw, str):
        return None
    try:
        ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None
    return ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)


def _new_session_stats() -> dict:
    """A zeroed current-session accumulator.

    Used from __init__, on a session-file change, and on truncation, so the
    three sites cannot drift apart.
    """
    return {
        "input": 0, "output": 0, "cache_write": 0, "cache_read": 0,
        "msgs_user": 0, "msgs_assistant": 0, "agents": set(),
    }


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
        self._session_pos: int = 0  # byte offset for incremental reads
        self._session_stats: dict = _new_session_stats()
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
                # A session switch or an in-place truncation lowers the total.
                # Both reset the baseline below, but guard here too so a
                # negative sample can never reach the sparkline.
                if delta >= 0:
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
        # errors="replace", matching the incremental reader: strict UTF-8
        # raises from the line ITERATOR, outside any per-line guard, so a
        # single bad byte anywhere zeroes the whole file's stats and caches
        # that zero. Both readers must tolerate the same bytes.
        with open(fpath, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    obj = json.loads(line)
                # Broad, like the incremental reader: json.loads raises
                # ValueError for malformed input but RecursionError (a
                # RuntimeError) on a deeply nested document, which would
                # otherwise abandon the rest of the file -- and the partial
                # result gets cached against the file's (mtime, size) until it
                # next changes.
                except Exception:
                    continue
                if not isinstance(obj, dict):
                    continue  # a bare scalar or array is not a session record

                msg_type = obj.get("type")

                # Track timestamps (normalised to aware UTC by the helper)
                ts = _parse_timestamp(obj.get("timestamp"))
                if ts is not None:
                    if totals["earliest"] is None or ts < totals["earliest"]:
                        totals["earliest"] = ts
                    if totals["latest"] is None or ts > totals["latest"]:
                        totals["latest"] = ts

                if msg_type == "assistant":
                    totals["msgs_assistant"] += 1
                    for key, count in _usage_tokens(obj).items():
                        totals[key] += count
                elif msg_type == "user":
                    totals["msgs_user"] += 1

    def _accumulate_session_record(self, obj: dict) -> None:
        """Fold one parsed JSONL record into the current-session totals."""
        msg_type = obj.get("type")
        if msg_type == "assistant":
            self._session_stats["msgs_assistant"] += 1
            for key, count in _usage_tokens(obj).items():
                self._session_stats[key] += count
        elif msg_type == "user":
            self._session_stats["msgs_user"] += 1
        elif msg_type == "progress":
            data = obj.get("data") or {}
            if isinstance(data, dict) and data.get("type") == "agent_progress":
                aid = data.get("agentId", "")
                if aid:
                    self._session_stats["agents"].add(aid)

    def _update_current_session(self) -> None:
        """Incrementally read the current (latest) session file."""
        # Find latest session file
        all_files = []
        for project_dir in glob.glob(os.path.join(_PROJECTS_DIR, "*")):
            all_files.extend(glob.glob(os.path.join(project_dir, "*.jsonl")))
        if not all_files:
            return

        # Skip unstat-able entries rather than aborting: a single dangling
        # symlink under ~/.claude/projects/ would otherwise make every cycle
        # bail here, freezing session_*, agents_active, token_rate and the
        # sparkline forever with no log line.
        stattable = []
        for f in all_files:
            try:
                stattable.append((os.path.getmtime(f), f))
            except OSError:
                continue
        if not stattable:
            return
        latest = max(stattable)[1]

        # If session file changed, reset
        if latest != self._session_file:
            self._session_file = latest
            self._session_pos = 0
            self._session_stats = _new_session_stats()
            # Drop rate history and the baseline: the new session's total is
            # unrelated to the old one, and the difference would otherwise
            # land in the sparkline as one large negative sample.
            self._rate_samples.clear()
            self._prev_total = 0
            self._prev_time = 0.0

        try:
            size = os.path.getsize(self._session_file)
        except OSError:
            return
        if size < self._session_pos:
            # File shrank: truncated or replaced in place. Without this, every
            # later seek() lands past EOF and the session stays frozen forever.
            self._session_pos = 0
            self._session_stats = _new_session_stats()
            # Re-establish the rate baseline on the next cycle rather than
            # emitting the drop as a rate sample.
            self._prev_total = 0
            self._prev_time = 0.0

        # Read new bytes from the current position. Binary, because a text
        # handle's tell() returns an opaque cookie that cannot be compared
        # with or added to a byte count.
        try:
            with open(self._session_file, "rb") as f:
                f.seek(self._session_pos)
                chunk = f.read()
            if not chunk:
                return
            # Keep the trailing fragment: the writer may be mid-line, and
            # advancing past it would drop that record permanently.
            consumed = chunk.rfind(b"\n") + 1
            if consumed == 0:
                return  # nothing complete yet; try again next cycle
            for raw in chunk[:consumed].split(b"\n"):
                if not raw:
                    continue
                try:
                    obj = json.loads(raw.decode("utf-8", errors="replace"))
                # Broad on purpose. json.loads raises ValueError for malformed
                # input, but RecursionError (a RuntimeError, NOT a ValueError)
                # for a deeply nested document. A narrow tuple would let that
                # escape to the outer handler, abandoning every remaining line
                # AND leaving _session_pos unadvanced -- so the same bad line
                # would stall the reader on every future cycle.
                except Exception:
                    continue
                if not isinstance(obj, dict):
                    continue  # a bare scalar or array is not a session record
                try:
                    self._accumulate_session_record(obj)
                # Broad for the same reason: one malformed record must not
                # cost the rest of the batch or wedge the read position.
                except Exception:
                    continue
            self._session_pos += consumed
        # Broad: collect() must never raise. Losing this cycle's incremental
        # read is recoverable; propagating loses every claude.* metric.
        except Exception:
            pass
