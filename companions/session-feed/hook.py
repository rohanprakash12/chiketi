#!/usr/bin/env python3
"""Claude Code hook: mark a session as waiting for the user, or clear the mark.

Notification -> set flag (permission prompts, questions, idle reminders).
UserPromptSubmit / PostToolUse / Stop / SessionEnd -> clear flag.
Never blocks Claude: always exits 0 with no output.
"""
import json
import sys
import time
from pathlib import Path

FLAGS = Path.home() / '.claude' / 'session-display' / 'waiting'

try:
    event = json.load(sys.stdin)
    sid = event.get('session_id')
    if sid and '/' not in sid:
        flag = FLAGS / sid
        if event.get('hook_event_name') == 'Notification':
            FLAGS.mkdir(parents=True, exist_ok=True)
            flag.write_text(json.dumps({
                'at': time.time(),
                'message': event.get('message'),
                'type': event.get('notification_type'),
            }))
        else:
            flag.unlink(missing_ok=True)
except Exception:  # noqa: BLE001, S110 -- a hook must never block or fail Claude Code
    pass
