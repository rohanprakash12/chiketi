#!/usr/bin/env python3
"""Read-only Claude Code and Codex session feed for chiketi's Sessions screen.

Runs on the machine where the Claude Code / Codex sessions run, and serves
GET /api/sessions to chiketi's SessionsCollector (sessions.toml `url`).
Configure with environment variables: FEED_ALLOW (comma-separated client IPs,
default 127.0.0.1), FEED_PORT (8766), FEED_BACKUP_URL and FEED_PAGE (optional).
hook.py next to it marks sessions that are waiting for input.

Serves GET /api/sessions from ~/.claude/sessions/*.json plus the "needs input"
flags written by hook.py. Only name, project, state, timing, token counts and
the number of running subagents leave this host; session keys, auth tokens and
socket paths are never served, and transcript content is read only for its
usage counters.
"""
import calendar
import json
import os
import re
import sqlite3
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SESSIONS = Path.home() / '.claude' / 'sessions'
FLAGS = Path.home() / '.claude' / 'session-display' / 'waiting'
PROJECTS = Path.home() / '.claude' / 'projects'
AGENT_STALE = 600  # s: a subagent transcript untouched this long is not running
CODEX = Path.home() / '.codex'
ROLLOUT_ID = re.compile(r'rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$')
PORT = int(os.environ.get('FEED_PORT', '8766'))
# Clients allowed to read the feed (comma-separated IPs). Default: this machine only.
ALLOWED = {a.strip() for a in os.environ.get('FEED_ALLOW', '127.0.0.1').split(',') if a.strip()}
# Optional extras for a stand-alone kiosk page: a backup-status URL to proxy at
# /api/backup, and an HTML page to serve at /. Both off unless set.
BACKUP_URL = os.environ.get('FEED_BACKUP_URL', '')
PAGE = Path(os.environ['FEED_PAGE']) if os.environ.get('FEED_PAGE') else None


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


class Usage:
    """Per-transcript token totals, read incrementally (transcripts grow to
    tens of MB). Counts input + cache writes + output: the tokens a session
    actually sent or generated. Cache reads are left out; they re-count the
    same context on every turn. Streaming writes one line per content block
    with the same usage, so each message id counts once."""

    def __init__(self):
        self.lock = threading.Lock()
        self.files = {}  # path -> [offset, total, seen ids, last entry]

    def scan(self, path):
        with self.lock:
            st = self.files.setdefault(path, [0, 0, set(), None])
            try:
                size = path.stat().st_size
                if size < st[0]:
                    st[:] = [0, 0, set(), None]
                with path.open('rb') as f:
                    f.seek(st[0])
                    for raw in f:
                        if not raw.endswith(b'\n'):
                            break  # half-written line: read it next time
                        st[0] += len(raw)
                        try:
                            d = json.loads(raw)
                        except ValueError:
                            continue
                        if d.get('type') not in ('assistant', 'user'):
                            continue
                        st[3] = d
                        m = d.get('message') if d.get('type') == 'assistant' else None
                        if isinstance(m, dict) and isinstance(m.get('usage'), dict) and m.get('id') not in st[2]:
                            st[2].add(m.get('id'))
                            u = m['usage']
                            st[1] += sum(int(u.get(k) or 0) for k in
                                         ('input_tokens', 'cache_creation_input_tokens', 'output_tokens'))
            except OSError:
                pass
            return st[1], st[3]

    def session(self, sid):
        """(total tokens incl. subagents, subagents running now)."""
        total, running, now = 0, 0, time.time()
        for path in PROJECTS.glob(f'*/{sid}.jsonl'):
            total += self.scan(path)[0]
        for path in PROJECTS.glob(f'*/{sid}/subagents/agent-*.jsonl'):
            t, last = self.scan(path)
            total += t
            try:
                fresh = now - path.stat().st_mtime < AGENT_STALE
            except OSError:
                fresh = False
            done = (last is not None and last.get('type') == 'assistant'
                    and (last.get('message') or {}).get('stop_reason') == 'end_turn')
            running += fresh and not done
        return total, running


USAGE = Usage()


def iso_ts(text):
    """Epoch seconds from Codex's UTC timestamps (2026-10-13T01:50:30.457Z)."""
    try:
        return calendar.timegm(time.strptime(text[:19], '%Y-%m-%dT%H:%M:%S'))
    except (TypeError, ValueError):
        return None


class Codex:
    """Live Codex sessions. A session is live while some process has its
    rollout file open (Codex appends to it for the whole session). State
    comes from the rollout's last task event: started -> busy, complete or
    aborted -> idle. Codex logs no event while it waits for an approval, so
    a Codex session never shows as waiting. Tokens: input - cached input +
    output, from the last token_count, matching the Claude count."""

    def __init__(self):
        self.lock = threading.Lock()
        self.files = {}  # path -> [offset, state, since, tokens]

    def open_rollouts(self):
        """{rollout path: pid} for rollouts held open by our processes."""
        found = {}
        root = str(CODEX / 'sessions')
        for pid in os.listdir('/proc'):
            if not pid.isdigit():
                continue
            try:
                for fd in os.listdir(f'/proc/{pid}/fd'):
                    try:
                        target = os.readlink(f'/proc/{pid}/fd/{fd}')
                    except OSError:
                        continue
                    if target.startswith(root) and target.endswith('.jsonl'):
                        found[target] = int(pid)
            except OSError:
                continue
        return found

    def scan(self, path):
        st = self.files.setdefault(path, [0, 'idle', None, None])
        try:
            if os.path.getsize(path) < st[0]:
                st[:] = [0, 'idle', None, None]
            with open(path, 'rb') as f:
                f.seek(st[0])
                for raw in f:
                    if not raw.endswith(b'\n'):
                        break
                    st[0] += len(raw)
                    try:
                        d = json.loads(raw)
                    except ValueError:
                        continue
                    p = d.get('payload') if isinstance(d.get('payload'), dict) else {}
                    kind = p.get('type') if d.get('type') == 'event_msg' else None
                    if kind == 'task_started':
                        st[1], st[2] = 'busy', iso_ts(d.get('timestamp'))
                    elif kind in ('task_complete', 'turn_aborted'):
                        st[1], st[2] = 'idle', iso_ts(d.get('timestamp'))
                    elif kind == 'token_count':
                        u = ((p.get('info') or {}).get('total_token_usage') or {})
                        try:
                            st[3] = max(0, int(u.get('input_tokens') or 0) - int(u.get('cached_input_tokens') or 0)) + \
                                int(u.get('output_tokens') or 0)
                        except (TypeError, ValueError):
                            pass
        except OSError:
            pass
        return st

    def sessions(self):
        with self.lock:
            live = self.open_rollouts()
            if not live:
                return []
            meta = {}
            try:
                db = sqlite3.connect(f'file:{CODEX / "state_5.sqlite"}?mode=ro', uri=True, timeout=1)
                try:
                    marks = ','.join('?' * len(live))
                    for row in db.execute('select id, rollout_path, cwd, coalesce(name, title), source, '
                                          f'created_at from threads where rollout_path in ({marks})',
                                          list(live)):
                        meta[row[1]] = row
                finally:
                    db.close()
            except sqlite3.Error:
                pass
            out, subagents = [], {}
            for path, pid in live.items():
                row = meta.get(path)
                if row and 'subagent' in str(row[4] or ''):
                    subagents[pid] = subagents.get(pid, 0) + 1
            for path, pid in live.items():
                row = meta.get(path)
                if row and 'subagent' in str(row[4] or ''):
                    continue
                st = self.scan(path)
                m = ROLLOUT_ID.search(path)
                cwd = (row[2] if row else '') or ''
                name = (row[3] if row else None) or (m.group(1)[:8] if m else 'codex')
                out.append({
                    'name': str(name)[:64],
                    'project': '~' if cwd == str(Path.home()) else Path(cwd).name,
                    'state': st[1],
                    'since': st[2] or (row[5] if row else None),
                    'message': None,
                    'started': row[5] if row else None,
                    'tokens': st[3],
                    'agents': subagents.get(pid, 0),
                    'tool': 'codex',
                })
            return out


CODEX_SESSIONS = Codex()


def collect():
    sessions = []
    for path in SESSIONS.glob('*.json'):
        try:
            d = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if not isinstance(d.get('pid'), int) or not alive(d['pid']):
            continue
        state = d.get('status') or 'unknown'
        since = (d.get('statusUpdatedAt') or d.get('updatedAt') or 0) / 1000
        flag = FLAGS / str(d.get('sessionId'))
        waiting = None
        if state != 'idle' and flag.is_file():
            try:
                waiting = json.loads(flag.read_text())
            except (OSError, ValueError):
                waiting = {}
        if waiting is not None:
            state = 'waiting'
            since = waiting.get('at', since)
        cwd = d.get('cwd') or ''
        sid = str(d.get('sessionId') or '')
        tokens, agents = USAGE.session(sid) if sid and '/' not in sid and sid[0] != '.' else (None, None)
        sessions.append({
            'name': d.get('name') or str(d['pid']),
            'project': '~' if cwd == str(Path.home()) else Path(cwd).name,
            'state': state,
            'since': since,
            'message': (waiting or {}).get('message'),
            'started': (d.get('startedAt') or 0) / 1000,
            'tokens': tokens,
            'agents': agents,
            'tool': 'claude',
        })
    try:
        sessions.extend(CODEX_SESSIONS.sessions())
    except Exception:  # noqa: BLE001, S110 -- Codex trouble must never take the Claude list down
        pass
    return {'timestamp': time.time(), 'host': os.uname().nodename, 'sessions': sessions}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.client_address[0] not in ALLOWED:
            self.send_error(403)
            return
        try:
            if self.path == '/api/sessions':
                self.reply(json.dumps(collect()).encode(), 'application/json')
            elif self.path == '/api/backup' and BACKUP_URL:
                with urllib.request.urlopen(BACKUP_URL, timeout=4) as response:
                    self.reply(response.read(), 'application/json')
            elif self.path in ('/', '/kiosk') and PAGE:
                self.reply(PAGE.read_bytes(), 'text/html; charset=utf-8')
            else:
                self.send_error(404)
        except OSError as exc:
            self.send_error(502, str(exc))

    def reply(self, body, content_type):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    threading.Thread(target=collect, daemon=True).start()  # first transcript scan takes seconds
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
