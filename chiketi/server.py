"""Tiny HTTP control panel server."""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from chiketi.config import TIMING
from chiketi.themes import (
    get_active_theme, get_active_family, set_active_theme,
    get_families,
)
from chiketi.panel_spec import web_spec

CONTROL_PORT = 7777

# Maximum number of screen-rotation entries accepted from a POST body.
# Bounds memory growth from arbitrary client-supplied screen ids.
_MAX_SCREEN_ROTATION = 32

# Optional shared-secret token. When set (via start_server), POST/control
# requests must supply it in the X-Chiketi-Token header. GET telemetry stays
# open. None = no auth (trusted-LAN default).
_AUTH_TOKEN: str | None = None

# Module-level metrics getter — set by app.py after engine starts
_get_metrics = None

# Display configuration
_display_output: str = ""  # empty = auto/default
_display_brightness: float = 1.0
_display_width: int = 1024
_display_height: int = 600

# Per-screen rotation configuration: {screen_id: {enabled: bool, duration: int}}
# Populated with defaults on first /api/display GET
_screen_rotation: dict = {}

# Cache for UI asset files (read once, then served inline at render time)
_UI_ASSET_CACHE: dict = {}


def _get_session_env() -> dict[str, str]:
    """Get display env vars, auto-detecting from graphical session if needed."""
    from chiketi.app import _get_graphical_session_env
    env = {**os.environ}
    session_env = _get_graphical_session_env()
    for key in ("DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY"):
        if key not in env and key in session_env:
            env[key] = session_env[key]
    if "DISPLAY" not in env:
        from chiketi.app import _detect_display
        env["DISPLAY"] = _detect_display()
    return env


def _parse_xrandr(stdout: str) -> list[dict]:
    """Parse xrandr output into a list of display dicts."""
    outputs = []
    for line in stdout.splitlines():
        if " connected" in line or " disconnected" in line:
            parts = line.split()
            name = parts[0]
            connected = parts[1] == "connected" if len(parts) > 1 else False
            resolution = ""
            if connected and len(parts) > 2:
                for p in parts[2:]:
                    if "x" in p and p[0].isdigit():
                        resolution = p.split("+")[0]
                        break
            outputs.append({
                "name": name,
                "connected": connected,
                "resolution": resolution,
            })
    return outputs


# Cache for xrandr output discovery. Querying shells out to `xrandr --query`
# (up to a 5s timeout), so the kiosk's frequent /api/display polls must not
# trigger it every time. Results are cached with a TTL and only re-queried on
# expiry or an explicit refresh (the control panel's "scan displays").
_XRANDR_CACHE: list[dict] = []
_XRANDR_CACHE_TS: float = 0.0
_XRANDR_TTL_S: float = 20.0


def _get_xrandr_outputs(force: bool = False) -> list[dict]:
    """Return display outputs from cache, re-querying on TTL expiry or force."""
    global _XRANDR_CACHE, _XRANDR_CACHE_TS
    now = time.monotonic()
    if not force and _XRANDR_CACHE_TS and (now - _XRANDR_CACHE_TS) < _XRANDR_TTL_S:
        return _XRANDR_CACHE
    _XRANDR_CACHE = _query_xrandr_outputs()
    _XRANDR_CACHE_TS = now
    return _XRANDR_CACHE


def _query_xrandr_outputs() -> list[dict]:
    """Query display outputs, supporting both X11 and Wayland."""
    import glob

    # Get full session env (DISPLAY, WAYLAND_DISPLAY, XDG_RUNTIME_DIR)
    env = _get_session_env()

    # First try xrandr with the session env (works on X11 and XWayland)
    try:
        result = subprocess.run(
            ["xrandr", "--query"],
            capture_output=True, text=True, timeout=5, env=env,
        )
        outputs = _parse_xrandr(result.stdout)
        if outputs:
            return outputs
    except Exception:
        pass

    # Try each X display from lock files
    for lock in sorted(glob.glob("/tmp/.X*-lock")):
        try:
            num = lock.split(".X")[1].split("-lock")[0]
            run_env = {**env, "DISPLAY": f":{num}"}
            result = subprocess.run(
                ["xrandr", "--query"],
                capture_output=True, text=True, timeout=5,
                env=run_env,
            )
            outputs = _parse_xrandr(result.stdout)
            if outputs:
                for o in outputs:
                    o["display"] = f":{num}"
                return outputs
        except Exception:
            continue

    return []


def _apply_display_settings(output: str, brightness: float) -> bool:
    """Apply xrandr output and brightness settings."""
    global _display_output, _display_brightness
    try:
        args = ["xrandr"]
        if output:
            args.extend(["--output", output, "--brightness", str(brightness)])
        else:
            return False
        result = subprocess.run(
            args, capture_output=True, timeout=5,
            env=_get_session_env(),
        )
        if result.returncode != 0:
            return False
        _display_output = output
        _display_brightness = brightness
        return True
    except Exception:
        return False


def set_metrics_source(fn):
    """Register a callable that returns the latest metrics dict."""
    global _get_metrics
    _get_metrics = fn


def _serialize_metrics() -> dict:
    """Convert MetricValue dict to JSON-safe dict."""
    if _get_metrics is None:
        return {}
    raw = _get_metrics()
    out = {}
    for key, mv in raw.items():
        out[key] = {
            "value": mv.value,
            "unit": mv.unit,
            "available": mv.available,
            "extra": mv.extra,
        }
    return out


class ControlHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        route = parsed.path
        query = parse_qs(parsed.query)
        if route == "/" or route == "/index.html":
            self._serve_ui()
        elif route == "/display":
            self._serve_display()
        elif route == "/api/themes":
            families = {}
            for family_name, themes in get_families().items():
                families[family_name] = {
                    t.name: {
                        "primary": t.primary,
                        "accent": t.accent,
                        "background": t.background,
                        "panel": t.panel,
                        "border": t.border,
                        "header": t.header,
                        "dim": t.dim,
                        "critical": t.critical,
                    }
                    for t in themes
                }
            self._json_response({
                "active_family": get_active_family(),
                "active_variant": get_active_theme().name,
                "families": families,
            })
        elif route == "/api/metrics":
            self._json_response(_serialize_metrics())
        elif route == "/api/health":
            self._json_response({"status": "ok"})
        elif route == "/api/display":
            from chiketi.app import get_display_manager
            mgr = get_display_manager()
            payload = {
                "current_output": _display_output,
                "brightness": _display_brightness,
                "width": _display_width,
                "height": _display_height,
                "screen_rotation": _screen_rotation,
                "default_duration": TIMING.rotate_interval_s,
                "display_on": mgr.is_on if mgr else False,
            }
            # Output discovery shells out to xrandr — only the control panel
            # needs it (?outputs=1). The kiosk poll omits it and stays cheap.
            # ?refresh=1 forces a re-query for the "scan displays" button.
            if query.get("outputs", ["0"])[0] == "1":
                force = query.get("refresh", ["0"])[0] == "1"
                payload["outputs"] = _get_xrandr_outputs(force=force)
            self._json_response(payload)
        elif route.startswith("/assets/fonts/"):
            self._serve_font()
        else:
            self.send_error(404)

    def do_POST(self) -> None:
        # Optional shared-secret gate on state-changing requests.
        if _AUTH_TOKEN and self.headers.get("X-Chiketi-Token") != _AUTH_TOKEN:
            self.send_error(403, "Forbidden")
            return
        path = urlparse(self.path).path
        if path.startswith("/api/theme/"):
            rest = path.split("/api/theme/", 1)[1]
            # Support both /api/theme/family/variant and /api/theme/variant
            if "/" in rest:
                # family/variant format
                key = rest
            else:
                # Short variant name (backward compat)
                key = rest
            if set_active_theme(key):
                self._json_response({
                    "active_family": get_active_family(),
                    "active_variant": get_active_theme().name,
                })
            else:
                self.send_error(400, f"Unknown theme: {key}")
        elif path == "/api/display":
            global _display_width, _display_height, _screen_rotation
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length)) if length else {}
                # output is only acted on when explicitly present, so power- or
                # rotation-only POSTs aren't rejected/re-applied off stale state.
                output = body.get("output") or None
                brightness = float(body.get("brightness", _display_brightness))
                brightness = max(0.3, min(2.0, brightness))
                # Validate output only when the request explicitly targets one.
                if output:
                    valid_outputs = {o["name"] for o in _get_xrandr_outputs()}
                    if output not in valid_outputs:
                        self.send_error(400, f"Unknown output: {output}")
                        return
                # Display resolution
                if "width" in body and "height" in body:
                    _display_width = max(320, min(3840, int(body["width"])))
                    _display_height = max(200, min(2160, int(body["height"])))
                # Per-screen rotation settings
                if "screen_rotation" in body:
                    sr = body["screen_rotation"]
                    if isinstance(sr, dict):
                        for sid, cfg in sr.items():
                            # Bound growth: cap entry count and key length.
                            if (len(_screen_rotation) >= _MAX_SCREEN_ROTATION
                                    and sid not in _screen_rotation):
                                continue
                            if not isinstance(sid, str) or len(sid) > 64:
                                continue
                            if isinstance(cfg, dict):
                                _screen_rotation[sid] = {
                                    "enabled": bool(cfg.get("enabled", True)),
                                    "duration": max(3, min(600, int(cfg.get("duration", 10)))),
                                }
                # Display power toggle
                from chiketi.app import get_display_manager
                mgr = get_display_manager()
                if "display_on" in body and mgr:
                    if body["display_on"]:
                        mgr.turn_on()
                    else:
                        mgr.turn_off()
                # Apply xrandr only when an output was explicitly requested.
                applied = None
                if output:
                    applied = _apply_display_settings(output, brightness)
                resp = {
                    "current_output": _display_output,
                    "brightness": _display_brightness,
                    "width": _display_width,
                    "height": _display_height,
                    "screen_rotation": _screen_rotation,
                    "default_duration": TIMING.rotate_interval_s,
                    "display_on": mgr.is_on if mgr else False,
                }
                # Surface xrandr failure instead of a misleading bare 200.
                if applied is not None:
                    resp["applied"] = applied
                self._json_response(resp)
            except Exception as e:
                self.send_error(400, str(e))
        else:
            self.send_error(404)

    def _json_response(self, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_font(self) -> None:
        fname = os.path.basename(self.path)
        font_dir = os.path.join(os.path.dirname(__file__), "assets", "fonts")
        fpath = os.path.join(font_dir, fname)
        if os.path.isfile(fpath):
            with open(fpath, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "font/ttf")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def _serve_ui(self) -> None:
        html = _build_html()
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_display(self) -> None:
        html = _build_display_html()
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args) -> None:
        pass  # Silence request logging


def start_server(bind_host: str = "0.0.0.0", token: str | None = None) -> None:
    """Start the control panel server in a daemon thread.

    bind_host defaults to 0.0.0.0 so the panel is reachable from other LAN
    devices (e.g. a phone); set 127.0.0.1 to restrict to localhost. The server
    assumes a trusted LAN — pass a token (or set CHIKETI_TOKEN) to require an
    X-Chiketi-Token header on state-changing POST requests.
    """
    global _AUTH_TOKEN
    _AUTH_TOKEN = token or os.environ.get("CHIKETI_TOKEN") or None

    # Ensure a DisplayManager exists even if app.run() was not used. In the
    # normal app.run() path the manager is created first, so this is a no-op.
    from chiketi.app import get_display_manager, DisplayManager
    import chiketi.app as _app_mod
    if get_display_manager() is None:
        _app_mod._display_mgr = DisplayManager(
            f"http://localhost:{CONTROL_PORT}/display"
        )
    # ThreadingHTTPServer: a slow xrandr/subprocess call on one request must
    # not block the kiosk's metrics/theme polls.
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer((bind_host, CONTROL_PORT), ControlHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()


def _ui_asset(name: str) -> str:
    """Read and cache a UI asset file (read once at module level)."""
    cached = _UI_ASSET_CACHE.get(name)
    if cached is None:
        path = os.path.join(os.path.dirname(__file__), "assets", "ui", name)
        with open(path, encoding="utf-8") as fh:
            cached = fh.read()
        _UI_ASSET_CACHE[name] = cached
    return cached


def _build_display_html() -> str:
    """Build the fullscreen display page for Chromium kiosk mode."""
    spec = web_spec()
    pause_s = TIMING.pause_duration_s
    fonts = _ui_asset("fonts.css")
    css = _ui_asset("display.css").replace("__FONTS_CSS__", fonts)
    scripts = _ui_asset("display_app.js").replace(
        "__SHARED_HELPERS__", _ui_asset("shared_helpers.js")
    )
    html = (
        _ui_asset("display.html")
        .replace("__DISPLAY_CSS__", css)
        .replace("__DISPLAY_SCRIPTS__", scripts)
    )
    return (
        html
        .replace("__PANEL_SPEC_JSON__", json.dumps(spec))
        .replace("__PAUSE_S__", str(pause_s))
        .replace("__SCREEN_FUNCTIONS__", _screen_functions_js())
    )


def _screen_functions_js() -> str:
    """Return the JS screen renderer functions shared by both pages."""
    return _ui_asset("screen_functions.js")


def _build_html() -> str:
    spec = web_spec()
    fonts = _ui_asset("fonts.css")
    css = _ui_asset("control.css").replace("__FONTS_CSS__", fonts)
    scripts = _ui_asset("control_app.js").replace(
        "__SHARED_HELPERS__", _ui_asset("shared_helpers.js")
    )
    html = (
        _ui_asset("control.html")
        .replace("__CONTROL_CSS__", css)
        .replace("__CONTROL_SCRIPTS__", scripts)
    )
    return (
        html
        .replace("__PANEL_SPEC_JSON__", json.dumps(spec))
        .replace("__SCREEN_FUNCTIONS__", _screen_functions_js())
    )
