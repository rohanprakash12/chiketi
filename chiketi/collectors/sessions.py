"""Claude Code sessions from a session feed, for the Claude Sessions screen.

The feed is companions/session-feed (GET /api/sessions on the machine where the
sessions run). It is polled on its own thread so a slow or dead feed never
delays the metric engine, and the collector is inert unless
~/.config/chiketi/sessions.toml names a feed:

    url = "http://192.0.2.159:8766/api/sessions"
    poll_seconds = 2
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import tomllib
import urllib.error
import urllib.request

from chiketi.collectors.base import MetricCollector, MetricValue

STATES = ("waiting", "busy", "shell", "idle")
MAX_SESSIONS = 50
MAX_BODY = 1024 * 1024
# The feed counts as offline once nothing good has arrived for this many polls
# (at least OFFLINE_MIN_S), so a single dropped request does not flash the screen.
OFFLINE_POLLS = 5
OFFLINE_MIN_S = 10.0


def default_path() -> str:
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "chiketi", "sessions.toml")


def _text(v: object, n: int) -> str | None:
    return v[:n] if isinstance(v, str) else None


def _count(v: object) -> int | None:
    """A non-negative whole number, or None when the feed did not say."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not v >= 0 or v > 1e15:
        return None
    return int(v)


def clean_sessions(raw: object) -> list[dict]:
    """Keep only well-formed sessions, with every field typed and bounded.
    Escaping is the renderer's job; this only guarantees shape and size."""
    if not isinstance(raw, list):
        return []
    out = []
    for s in raw:
        if not isinstance(s, dict) or not isinstance(s.get("name"), str):
            continue
        since = s.get("since")
        out.append({
            "name": s["name"][:64],
            "project": _text(s.get("project"), 64) or "",
            "state": s.get("state") if s.get("state") in STATES else "idle",
            "since": float(since) if isinstance(since, (int, float)) and not isinstance(since, bool) else None,
            "message": _text(s.get("message"), 200),
            "tokens": _count(s.get("tokens")),
            "agents": _count(s.get("agents")),
            "tool": s.get("tool") if s.get("tool") in ("claude", "codex") else "claude",
        })
        if len(out) >= MAX_SESSIONS:
            break
    return out


def _load(path: str) -> tuple[str, float] | None:
    try:
        with open(path, "rb") as f:
            raw = tomllib.load(f)
    except FileNotFoundError:
        return None
    except (OSError, tomllib.TOMLDecodeError) as exc:
        print(f"chiketi: sessions feed disabled, {path}: {exc}", file=sys.stderr)
        return None
    url = raw.get("url")
    poll = raw.get("poll_seconds", 2)
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        print(f"chiketi: sessions feed disabled, {path}: url must be http(s)", file=sys.stderr)
        return None
    if isinstance(poll, bool) or not isinstance(poll, (int, float)) or not 1 <= poll <= 60:
        print(f"chiketi: sessions feed disabled, {path}: poll_seconds must be 1-60", file=sys.stderr)
        return None
    return url, float(poll)


class SessionsCollector(MetricCollector):
    namespace = "sessions"

    def __init__(self, path: str | None = None, start: bool = True,
                 opener=urllib.request.urlopen, clock=time.time) -> None:
        self._opener, self._clock = opener, clock
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._sessions: list[dict] = []
        self._host = ""
        self._checked_at: float | None = None
        self._started = clock()
        cfg = _load(path or default_path())
        self._url, self._poll = cfg if cfg else (None, 2.0)
        if self._url and start:
            threading.Thread(target=self._run, name="sessions-feed", daemon=True).start()

    def _run(self) -> None:
        while not self._stop.is_set():
            self.poll_once()
            self._stop.wait(self._poll)

    def poll_once(self) -> None:
        try:
            resp = self._opener(urllib.request.Request(self._url), timeout=3.0)
            data = json.loads(resp.read(MAX_BODY))
            resp.close()
        except (urllib.error.URLError, OSError, ValueError):
            return
        if not isinstance(data, dict):
            return
        sessions = clean_sessions(data.get("sessions"))
        host = _text(data.get("host"), 32) or ""
        with self._lock:
            self._sessions, self._host, self._checked_at = sessions, host, self._clock()

    def collect(self) -> dict[str, MetricValue]:
        if not self._url:
            return {self._key("status"): MetricValue("unconfigured")}
        with self._lock:
            sessions, host, checked = self._sessions, self._host, self._checked_at
        now = self._clock()
        limit = max(OFFLINE_MIN_S, OFFLINE_POLLS * self._poll)
        last = checked if checked is not None else self._started
        if now - last > limit:
            status = "offline"
        elif checked is None:
            status = "pending"
        else:
            status = "ok"
        return {
            self._key("status"): MetricValue(status),
            self._key("list"): MetricValue(sessions),
            self._key("checked_at"): MetricValue(checked, "s", available=checked is not None,
                                                 extra={"poll_seconds": self._poll, "host": host}),
        }
