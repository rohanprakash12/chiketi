# lcd-snap

Shows chiketi on a screen that has no browser — for example a USB LCD driven by
its own small program. lcd-snap keeps one headless Chromium page open on
`/display?device=<id>&feed=picture` at the screen's size and serves the latest
screenshot at `GET /lcd.png` (port 7778). The program driving the screen fetches
that picture every couple of seconds. The display pairs like any other (its
pairing code appears on the screen), and `feed=picture` tells chiketi it has no
input, so it rotates.

## Setup (on the chiketi server)

- Browser: Chrome for Testing's **headless shell** (e.g. from a Playwright cache)
  in `/opt/lcd-snap/chrome-headless-shell-linux64/`. Not a snap Chromium: snaps
  intermittently refuse to start from a system service ("not a snap cgroup").
- Ubuntu 23.10+ blocks the user namespaces Chromium's sandbox needs;
  `apparmor-lcd-snap-chrome` grants `userns` to that one binary
  (`/etc/apparmor.d/`, then `apparmor_parser -r`). The sandbox stays on.
- Python venv with `websockets` at `/opt/lcd-snap/venv`; `lcd_snap.py` in `/opt/lcd-snap/`.
- A systemd unit runs it with `Restart=always` and these settings:

| Variable | Default | Meaning |
|---|---|---|
| `LCD_URL` | `http://127.0.0.1:7777/display?device=lcd&feed=picture` | Page to render. Use the server's LAN address so the pairing page shows a usable panel address. |
| `LCD_ALLOW` | `127.0.0.1` | Comma-separated IPs allowed to fetch `/lcd.png` (the machine driving the screen) |
| `LCD_W`, `LCD_H` | `1920`, `462` | The screen's size in pixels |

The browser's profile and log live in `~/.local/state/lcd-snap/`. Any browser
trouble ends the process and systemd restarts it with a fresh profile.
