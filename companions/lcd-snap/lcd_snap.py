#!/usr/bin/env python3
"""Renders chiketi's display for a screen that has no browser (e.g. a USB LCD).

Keeps one headless Chromium page open on this host's chiketi /display at the
LCD's size and serves its latest screenshot at GET /lcd.png (port 7778), so
the program driving the LCD only fetches a picture. Configure with LCD_URL,
LCD_ALLOW, LCD_W and LCD_H. Read-only: it never posts
to chiketi. Any browser trouble ends the process; systemd starts it again.

The browser is Chrome for Testing's headless shell in /opt/lcd-snap, not the
Chromium snap: the snap refuses, intermittently, to start from a system
service ("not a snap cgroup"). A browser left over from a killed run is
found by its profile directory and ended before a new one starts.
"""
import asyncio
import base64
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import websockets

URL = os.environ.get('LCD_URL', 'http://127.0.0.1:7777/display?device=lcd&feed=picture')
W, H = int(os.environ.get('LCD_W', '1920')), int(os.environ.get('LCD_H', '462'))
EVERY = 2.0          # seconds between captures
STALE = 15.0         # an older picture is not served
PORT = 7778
CDP = 9223
# Who may fetch the picture (comma-separated IPs): the machine driving the LCD.
ALLOWED = {a.strip() for a in os.environ.get('LCD_ALLOW', '127.0.0.1').split(',') if a.strip()}
BROWSER = '/opt/lcd-snap/chrome-headless-shell-linux64/chrome-headless-shell'
STATE = os.path.expanduser('~/.local/state/lcd-snap')
PROFILE = os.path.join(STATE, 'profile')
LOG = os.path.join(STATE, 'browser.log')   # the browser's own messages, last run

latest = {'png': None, 'at': 0.0}
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.client_address[0] not in ALLOWED:
            self.send_error(403)
            return
        if self.path != '/lcd.png':
            self.send_error(404)
            return
        with lock:
            png, at = latest['png'], latest['at']
        if png is None or time.time() - at > STALE:
            self.send_error(503, 'no fresh frame')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'image/png')
        self.send_header('Content-Length', str(len(png)))
        self.send_header('X-Captured-At', f'{at:.3f}')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(png)

    def log_message(self, *args):
        pass


def kill_browser():
    """End any browser on our profile, including one a crashed run left."""
    pattern = f'user-data-dir={PROFILE}'
    subprocess.run(['pkill', '-f', pattern], check=False)
    for _ in range(50):
        if subprocess.run(['pgrep', '-f', pattern], capture_output=True, check=False).returncode != 0:
            break
        time.sleep(0.2)
    else:
        subprocess.run(['pkill', '-KILL', '-f', pattern], check=False)
        time.sleep(1)
    # A fresh profile every start: no lock left by a killed browser, no
    # session restore racing our own navigation.
    shutil.rmtree(PROFILE, ignore_errors=True)
    os.makedirs(PROFILE, exist_ok=True)


def log(msg):
    print(f'lcd-snap: {msg}', file=sys.stderr, flush=True)


async def capture():
    page, last = None, None
    for i in range(60):
        try:
            # Short local calls to the browser's debug port; blocking is fine here.
            with urllib.request.urlopen(f'http://127.0.0.1:{CDP}/json', timeout=2) as r:  # noqa: ASYNC210
                pages = [t for t in json.load(r) if t.get('type') == 'page']
            if not pages and i >= 10:
                req = urllib.request.Request(f'http://127.0.0.1:{CDP}/json/new?about:blank', method='PUT')
                with urllib.request.urlopen(req, timeout=2) as r:  # noqa: ASYNC210
                    pages = [json.load(r)]
            if pages:
                page = pages[0]
                break
        except Exception as exc:  # noqa: BLE001 -- browser not up yet: retry
            last = exc
        await asyncio.sleep(0.5)
    if page is None:
        raise RuntimeError(f'no page from chromium (last error: {last!r})')
    log(f'capturing {URL}')
    # No keepalive pings: Chromium's DevTools socket does not always answer
    # them, and a missed pong closed the connection every few minutes.
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=64 * 1024 * 1024,
                                  ping_interval=None) as ws:
        seq = 0

        async def call(method, params=None):
            nonlocal seq
            seq += 1
            await ws.send(json.dumps({'id': seq, 'method': method, 'params': params or {}}))
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), 30))
                if msg.get('id') == seq:
                    if 'error' in msg:
                        raise RuntimeError(f'{method}: {msg["error"]}')
                    return msg.get('result', {})

        await call('Emulation.setDeviceMetricsOverride',
                   {'width': W, 'height': H, 'deviceScaleFactor': 1, 'mobile': False})
        await call('Page.navigate', {'url': URL})
        await asyncio.sleep(3)
        while True:
            shot = await call('Page.captureScreenshot', {'format': 'png'})
            png = base64.b64decode(shot['data'])
            with lock:
                latest['png'], latest['at'] = png, time.time()
            await asyncio.sleep(EVERY)


def main():
    os.makedirs(STATE, exist_ok=True)
    kill_browser()
    subprocess.Popen([
        BROWSER, f'--remote-debugging-port={CDP}',
        '--remote-debugging-address=127.0.0.1', f'--window-size={W},{H}', '--hide-scrollbars',
        '--no-first-run', '--disable-gpu', f'--user-data-dir={PROFILE}', 'about:blank',
    ], stdout=subprocess.DEVNULL, stderr=open(LOG, 'w'))  # noqa: SIM115 -- the browser owns it
    threading.Thread(target=ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever,
                     daemon=True).start()
    try:
        asyncio.run(capture())
    except Exception as exc:  # noqa: BLE001 -- any trouble: log, exit, systemd restarts
        log(repr(exc))
    finally:
        kill_browser()
    sys.exit(1)


if __name__ == '__main__':
    main()
