# session-feed

A small read-only HTTP service that tells chiketi's **Claude Sessions** screen which
Claude Code and Codex sessions are running, on the machine where they run.

- `feed.py` serves `GET /api/sessions` (port 8766): name, project, state
  (`waiting` / `busy` / `shell` / `idle`), how long, total tokens, running subagents,
  and `tool` (`claude` or `codex`). It never serves session keys, auth tokens or
  socket paths; transcripts are read only for their usage counters.
  - Claude Code: `~/.claude/sessions/*.json`, plus the transcripts in `~/.claude/projects/`.
  - Codex: a session is live while a process holds its rollout open in
    `~/.codex/sessions/`; names come from `~/.codex/state_5.sqlite` (read-only).
    Codex logs nothing while waiting for approval, so Codex rows never show
    *needs input*.
- `hook.py` is a Claude Code hook that marks a session as waiting for input
  (Notification) and clears it (UserPromptSubmit, PostToolUse, Stop, SessionEnd).
  Add it to `~/.claude/settings.json` for those events:
  `"command": "python3 /path/to/chiketi/companions/session-feed/hook.py"`.

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `FEED_ALLOW` | `127.0.0.1` | Comma-separated client IPs allowed to read the feed (the chiketi server, and anything else that shows sessions) |
| `FEED_PORT` | `8766` | Listen port |
| `FEED_BACKUP_URL` | — | Optional status URL proxied at `/api/backup` |
| `FEED_PAGE` | — | Optional HTML page served at `/` |

Run it as a systemd service with an `EnvironmentFile=`; point chiketi's
`~/.config/chiketi/sessions.toml` at it:

```toml
url = "http://<feed-host>:8766/api/sessions"
poll_seconds = 2
```
