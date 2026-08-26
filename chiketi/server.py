"""Tiny HTTP control panel server."""

from __future__ import annotations

import hmac
import ipaddress
import json
import math
import os
import subprocess
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from chiketi.config import TIMING
from chiketi.themes import (
    get_active_theme, set_active_theme,
    get_families,
)
from chiketi.panel_spec import web_spec

CONTROL_PORT = 7777

# Maximum number of screen-rotation entries accepted from a POST body.
# Bounds memory growth from arbitrary client-supplied screen ids.
_MAX_SCREEN_ROTATION = 32

# Maximum accepted POST body. Control payloads are a few hundred bytes; this
# ceiling stops an open-LAN client from forcing a large allocation, and the
# explicit negative check stops rfile.read(-1) from blocking a request thread
# until the peer disconnects.
_MAX_BODY_BYTES = 64 * 1024

# Optional shared-secret token. When set (via start_server), POST/control
# requests must supply it in the X-Chiketi-Token header. GET telemetry stays
# open. None = no auth (trusted-LAN default).
_AUTH_TOKEN: str | None = None

# Module-level metrics getter — set by app.py after engine starts
_get_metrics = None

# Guards every module-global mutable display/rotation value below, plus the
# xrandr cache. The server is threaded, so an /api/display GET snapshotting
# state can otherwise interleave with a POST mutating it -- the screen-rotation
# cap check is a check-then-insert, and width/height are a composite write.
# RLock, so a path that already holds it can call a helper that re-takes it.
_STATE_LOCK = threading.RLock()

# Serialises snapshot-and-write as one unit. _persist() used to snapshot under
# _STATE_LOCK and then write after releasing it, so two concurrent requests
# could write their snapshots out of order and leave the saved file describing
# an older state than the live one.
_PERSIST_LOCK = threading.Lock()

# Display configuration
_display_output: str = ""  # empty = auto/default
_display_brightness: float = 1.0
_display_width: int = 1024
_display_height: int = 600

# Per-screen rotation configuration: {screen_id: {enabled: bool, duration: int}}
# Populated with defaults on first /api/display GET
_screen_rotation: dict = {}

# The theme value that should be written to the state file. Deliberately
# distinct from the *active* theme: an explicit `--theme` flag is a one-off
# override, so it must not become permanent just because the user later moved
# the brightness slider. None means "nothing has claimed the persisted theme",
# in which case _persist() records whatever is live.
_persisted_theme: str | None = None

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
    """Return display outputs from cache, re-querying on TTL expiry or force.

    The lock is released around the query: `xrandr --query` can take up to 5s
    and must not block every other request while it runs.
    """
    global _XRANDR_CACHE, _XRANDR_CACHE_TS
    now = time.monotonic()
    with _STATE_LOCK:
        if not force and _XRANDR_CACHE_TS and (now - _XRANDR_CACHE_TS) < _XRANDR_TTL_S:
            return list(_XRANDR_CACHE)
    fresh = _query_xrandr_outputs()          # slow; runs unlocked
    with _STATE_LOCK:
        _XRANDR_CACHE = fresh
        _XRANDR_CACHE_TS = time.monotonic()
        return list(_XRANDR_CACHE)


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
        with _STATE_LOCK:
            _display_output = output
            _display_brightness = brightness
        return True
    except Exception:
        return False



def _num(value, field):
    """A real, finite number. Rejects bool (True is an int in Python), NaN,
    infinity, and strings that merely look boolean."""
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a number, not a boolean")
    if isinstance(value, str):
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{field} is not a number") from None
    if not isinstance(value, (int, float)):
        raise ValueError(f"{field} is not a number")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{field} must be finite")
    return value


def _flag(value, field):
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be true or false")
    return value


def _validate_display_body(body: dict, current_brightness: float) -> dict:
    """Turn a POST body into a fully-validated candidate, or raise ValueError.

    Nothing here touches live state. The handler used to validate and mutate
    interleaved, so a body whose later field was bad returned 400 having
    already committed the earlier ones -- a request could be rejected and
    still change your brightness.
    """
    c: dict = {}

    if "brightness" in body:
        c["brightness"] = max(0.3, min(2.0, _num(body["brightness"], "brightness")))
    else:
        c["brightness"] = current_brightness

    if "width" in body or "height" in body:
        if not ("width" in body and "height" in body):
            raise ValueError("width and height must be given together")
        c["width"] = int(max(320, min(3840, _num(body["width"], "width"))))
        c["height"] = int(max(200, min(2160, _num(body["height"], "height"))))

    if "screen_rotation" in body:
        sr = body["screen_rotation"]
        if not isinstance(sr, dict):
            raise ValueError("screen_rotation must be an object")
        clean: dict = {}
        for sid, cfg in sr.items():
            if not isinstance(sid, str) or not sid or len(sid) > 64:
                raise ValueError("screen_rotation ids must be strings of 1-64 chars")
            if not isinstance(cfg, dict):
                raise ValueError(f"screen_rotation[{sid}] must be an object")
            clean[sid] = {
                "enabled": _flag(cfg.get("enabled", True), f"screen_rotation[{sid}].enabled"),
                "duration": int(max(3, min(600, _num(cfg.get("duration", 10),
                                                     f"screen_rotation[{sid}].duration")))),
            }
        c["screen_rotation"] = clean

    if "display_on" in body:
        c["display_on"] = _flag(body["display_on"], "display_on")

    out = body.get("output") or None
    if out is not None and not isinstance(out, str):
        raise ValueError("output must be a string")
    c["output"] = out
    return c


def _active_theme_key() -> str:
    """'Family/Variant' snapshotted from a single Theme object."""
    t = get_active_theme()
    return f"{t.family}/{t.name}"


def _token_matches(supplied: str | None) -> bool:
    """Constant-time token compare that cannot raise.

    hmac.compare_digest rejects str arguments containing non-ASCII with a
    TypeError, and the header is attacker-controlled: a token header of
    "s\u00e9cret" killed the handler thread and dropped the connection with
    zero bytes. Comparing bytes has no such restriction.
    """
    if _AUTH_TOKEN is None:
        return True
    try:
        given = (supplied or "").encode("utf-8", "surrogatepass")
        expected = _AUTH_TOKEN.encode("utf-8", "surrogatepass")
    except Exception:
        return False
    return hmac.compare_digest(given, expected)


def _origin_allowed(origin: str, host_header: str) -> bool:
    """Allow same-origin and null/absent Origin; reject everything else.

    A browser always sends Origin on cross-origin POSTs, so rejecting a
    mismatch blocks drive-by CSRF from any page the user happens to visit.
    Requests with no Origin (curl, scripts, non-browser clients) are allowed so
    nothing that works today breaks.
    """
    if not origin:
        return True
    # "null" is NOT the same as absent. A sandboxed iframe sends Origin: null,
    # so allowing it hands the CSRF bypass back to any page that embeds one.
    # Real non-browser clients (curl, scripts) send no Origin header at all,
    # which is still allowed above - so rejecting null breaks nothing.
    if origin == "null":
        return False
    try:
        parsed = urlparse(origin)
    except ValueError:
        # urlparse raises on malformed IPv6 forms ("http://[::1"). The header is
        # attacker-controlled, so this must be a rejection, not a crash: an
        # uncaught raise here kills the handler thread and drops the connection
        # with no response at all.
        return False
    if not parsed.netloc:
        return False
    # Compare host:port against the Host header the client used to reach us.
    return parsed.netloc == host_header


# Host values that can only ever name this machine on a network the user
# controls. A DNS-rebinding attacker must serve the page from a registrable
# public domain (evil.example), so it can never produce one of these.
_LOCAL_HOST_SUFFIXES = (
    ".local",      # mDNS / avahi - chiketi.local
    ".ts.net",     # Tailscale MagicDNS - box.tail1234.ts.net
    ".internal",   # common private-zone convention
    ".lan",        # common router-assigned zone
    ".home.arpa",  # RFC 8375, the reserved name for home networks
)
_LOCAL_HOST_NAMES = ("localhost", "localhost.localdomain", "")


def _split_host_port(host_header: str) -> str | None:
    """Hostname out of a Host header, port and IPv6 brackets removed.

    None means the header is malformed and no rule should be applied to it.
    """
    host = (host_header or "").strip().lower()
    if host.startswith("["):
        # "[::1]:7777" -> "::1". An unclosed bracket is malformed, not local.
        end = host.find("]")
        return host[1:end] if end > 1 else None
    if "[" in host or "]" in host:
        return None
    return host.split(":", 1)[0]


def _host_allowed(host_header: str) -> bool:
    """Reject Host values that only a DNS-rebinding attacker would send.

    The Origin check below asks "does Origin match Host?", which a rebinding
    attacker satisfies trivially: they control the DNS name, so both headers
    say evil.example and agree. What they cannot do is make the victim's
    browser send a Host that is a bare IP or a private-zone name - that would
    require the user to type it.

    So: allow IP literals (covers the LAN address and Tailscale's 100.64/10),
    localhost, and private DNS zones. Reject registrable public domains. Every
    way a user actually reaches this panel is on the allowed side, which is
    why this needs no configuration and no flag.
    """
    host = _split_host_port(host_header)
    if host is None:
        return False
    if host in _LOCAL_HOST_NAMES:
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        # Not an IP literal - fall through to the name rules.
        pass
    # A bare single-label name ("chiketi", "myserver") cannot be a public
    # domain, so it cannot be the rebinding vector either.
    if "." not in host:
        return True
    return host.endswith(_LOCAL_HOST_SUFFIXES)


def _display_payload(display_on: bool) -> dict:
    """Immutable snapshot of display state, safe to serialize.

    display_on is passed in rather than read here on purpose:
    DisplayManager.is_on takes DisplayManager._lock, and taking that under
    _STATE_LOCK at this call site while another path takes them in the
    opposite order is a lock-order inversion. Callers compute it first.
    """
    with _STATE_LOCK:
        return {
            "current_output": _display_output,
            "brightness": _display_brightness,
            "width": _display_width,
            "height": _display_height,
            "screen_rotation": {k: dict(v) for k, v in _screen_rotation.items()},
            "default_duration": TIMING.rotate_interval_s,
            "display_on": display_on,
        }


def apply_saved_state(saved: dict) -> None:
    """Adopt settings loaded from the state file. Never raises.

    Called once at startup, after any CLI flag has already been applied. The
    theme is NOT set here -- app.run() does that, because it alone knows
    whether a --theme flag should win. Every field is re-checked rather than
    trusted: this is public API and a caller may hand us anything.
    """
    global _display_output, _display_brightness
    global _display_width, _display_height
    global _screen_rotation, _persisted_theme
    if not isinstance(saved, dict):
        return
    with _STATE_LOCK:
        theme = saved.get("theme")
        _persisted_theme = theme if isinstance(theme, str) and theme else None
        output = saved.get("output")
        if isinstance(output, str):
            _display_output = output
        brightness = saved.get("brightness")
        if isinstance(brightness, (int, float)) and not isinstance(brightness, bool):
            _display_brightness = float(brightness)
        width = saved.get("width")
        height = saved.get("height")
        if (isinstance(width, int) and not isinstance(width, bool)
                and isinstance(height, int) and not isinstance(height, bool)):
            # Composite write: both halves land under the same lock hold.
            _display_width = width
            _display_height = height
        rotation = saved.get("screen_rotation")
        if isinstance(rotation, dict):
            # Detached copy: the caller keeps its own dict, and a later mutation
            # of either side must not reach through into the other.
            _screen_rotation = {
                sid: dict(cfg) for sid, cfg in rotation.items()
                if isinstance(sid, str) and isinstance(cfg, dict)
            }


def _persist() -> None:
    """Best-effort save of the current settings.

    Deliberately swallows everything: a read-only or full HOME is a supported
    situation, and persistence must never turn a working control POST into a
    500. save_state() already returns False rather than raising, but this runs
    on a request thread, so the guard covers the snapshot build too.
    """
    try:
        from chiketi.state import save_state
        with _PERSIST_LOCK:
            with _STATE_LOCK:
                snapshot = {
                    # One object, not two calls: get_active_family() and
                    # get_active_theme() read the same module global
                    # separately, so a theme change landing between them
                    # yields a family and a variant from different themes.
                    "theme": _persisted_theme or _active_theme_key(),
                    "screen_rotation": {k: dict(v)
                                        for k, v in _screen_rotation.items()},
                    "brightness": _display_brightness,
                    "output": _display_output,
                    "width": _display_width,
                    "height": _display_height,
                }
            # Inside _PERSIST_LOCK on purpose: writing outside it would let two
            # requests reorder their snapshots on disk.
            save_state(snapshot)
    except Exception:
        pass


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
    # Honoured by StreamRequestHandler.setup() as a socket timeout, so a client
    # that promises bytes in Content-Length and never sends them cannot pin a
    # request thread forever.
    timeout = 10

    def _read_body(self) -> dict | None:
        """Read and parse a JSON object body, or send an error and return None."""
        raw = self.headers.get("Content-Length", "0")
        try:
            length = int(raw)
        except (TypeError, ValueError):
            self.send_error(400, "Invalid Content-Length")
            return None
        if length < 0:
            self.send_error(400, "Invalid Content-Length")
            return None
        if length > _MAX_BODY_BYTES:
            self.send_error(413, "Request body too large")
            return None
        if not length:
            return {}
        try:
            parsed = json.loads(self.rfile.read(length))
        except Exception:
            # Deliberately broad. json.loads raises RecursionError on a deeply
            # nested body (~10k levels fits well inside the size cap), and
            # RecursionError subclasses RuntimeError -- not ValueError -- so a
            # narrow except lets it escape do_POST entirely, killing the handler
            # thread and dropping the connection with zero bytes. The body is
            # attacker-controlled; every parse failure must become a 400.
            self.send_error(400, "Malformed JSON body")
            return None
        if not isinstance(parsed, dict):
            self.send_error(400, "Malformed JSON body")
            return None
        return parsed

    def _parse_target(self):
        """Parse the request target, or send 400 and return None.

        The request line is attacker-controlled and urlparse() raises on
        malformed IPv6 forms, which absolute-form targets can carry
        ("GET http://[::1 HTTP/1.1"). An uncaught raise aborts the handler
        thread and drops the connection with zero bytes of response.
        """
        try:
            return urlparse(self.path)
        except ValueError:
            self.send_error(400, "Malformed request target")
            return None

    def do_GET(self) -> None:
        # Rebinding guard, applied to reads too: /api/metrics carries the
        # hostname, LAN IP, MAC and token usage, so the disclosure half of the
        # attack needs no POST at all.
        if not _host_allowed(self.headers.get("Host", "")):
            self.send_error(403, "Host not allowed")
            return
        parsed = self._parse_target()
        if parsed is None:
            return
        route = parsed.path
        query = parse_qs(parsed.query)
        if route == "/" or route == "/index.html":
            self._serve_ui()
        elif route == "/display":
            self._serve_display()
        elif route == "/api/themes":
            # snapshot once; family and variant must describe the same theme
            _theme = get_active_theme()
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
                "active_family": _theme.family,
                "active_variant": _theme.name,
                "families": families,
            })
        elif route == "/api/metrics":
            self._json_response(_serialize_metrics())
        elif route == "/api/health":
            self._json_response({"status": "ok"})
        elif route == "/api/display":
            from chiketi.app import get_display_manager
            mgr = get_display_manager()
            # is_on takes DisplayManager._lock -- read it before _STATE_LOCK.
            payload = _display_payload(mgr.is_on if mgr else False)
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
        # CSRF: control POSTs carry no Content-Type when they have no body, so
        # a browser treats them as "simple requests" and skips the preflight.
        # Rejecting a mismatched Origin is what stops any page the user visits
        # from flipping the theme or killing the display on their LAN.
        if not _host_allowed(self.headers.get("Host", "")):
            self.send_error(403, "Host not allowed")
            return
        if not _origin_allowed(
            self.headers.get("Origin", ""), self.headers.get("Host", "")
        ):
            self.send_error(403, "Cross-origin request rejected")
            return
        # Optional shared-secret gate on state-changing requests.
        if _AUTH_TOKEN and not _token_matches(self.headers.get("X-Chiketi-Token")):
            self.send_error(403, "Forbidden")
            return
        parsed = self._parse_target()
        if parsed is None:
            return
        path = parsed.path
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
                global _persisted_theme
                with _STATE_LOCK:
                    # Canonical family/variant, so a short-name POST
                    # ("hacker") is stored in the same form as everything else.
                    _persisted_theme = (
                        _active_theme_key()
                    )
                _persist()
                _theme = get_active_theme()
                self._json_response({
                    "active_family": _theme.family,
                    "active_variant": _theme.name,
                })
            else:
                self.send_error(400, f"Unknown theme: {key}")
        elif path == "/api/display":
            global _display_width, _display_height, _screen_rotation
            global _display_brightness
            body = self._read_body()
            if body is None:
                return
            try:
                with _STATE_LOCK:
                    current_brightness = _display_brightness
                # Validate the WHOLE request before touching anything.
                try:
                    cand = _validate_display_body(body, current_brightness)
                except ValueError as exc:
                    self.send_error(400, str(exc))
                    return
                output = cand["output"]
                brightness = cand["brightness"]
                # Output validation can shell out to xrandr, so it stays
                # outside the lock - and still before any mutation.
                if output:
                    valid_outputs = {o["name"] for o in _get_xrandr_outputs()}
                    if output not in valid_outputs:
                        self.send_error(400, f"Unknown output: {output}")
                        return
                    if (len(cand.get("screen_rotation", {})) > _MAX_SCREEN_ROTATION):
                        self.send_error(400, "too many screen_rotation entries")
                        return
                # Everything validated: commit as one atomic step.
                with _STATE_LOCK:
                    if "brightness" in body:
                        _display_brightness = cand["brightness"]
                    if "width" in cand:
                        _display_width = cand["width"]
                        _display_height = cand["height"]
                    if "screen_rotation" in cand:
                        merged = dict(_screen_rotation)
                        for sid, cfg in cand["screen_rotation"].items():
                            if len(merged) >= _MAX_SCREEN_ROTATION and sid not in merged:
                                continue
                            merged[sid] = cfg
                        _screen_rotation = merged
                # Display power toggle. mgr.turn_on/turn_off/is_on all take
                # DisplayManager._lock, so they stay outside _STATE_LOCK.
                from chiketi.app import get_display_manager
                mgr = get_display_manager()
                if "display_on" in cand and mgr:
                    if cand["display_on"]:
                        mgr.turn_on()
                    else:
                        mgr.turn_off()
                # Apply xrandr only when an output was explicitly requested.
                applied = None
                if output:
                    applied = _apply_display_settings(output, brightness)
                resp = _display_payload(mgr.is_on if mgr else False)
                # Surface xrandr failure instead of a misleading bare 200.
                if applied is not None:
                    resp["applied"] = applied
                    resp["applied_detail"] = (
                        "brightness applied via xrandr" if applied
                        else "saved, but xrandr could not apply it"
                    )
                _persist()
                self._json_response(resp)
            except Exception as e:
                self.send_error(400, str(e))
        else:
            self.send_error(404)

    def _json_response(self, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        # Scoped CORS: echo the Origin only when it matches the host the client
        # reached us on. A wildcard let any site the user visited read the
        # telemetry (hostname, IP, MAC, Claude usage) off their LAN.
        origin = self.headers.get("Origin", "")
        host = self.headers.get("Host", "")
        if origin and _host_allowed(host) and _origin_allowed(origin, host):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
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
            # The directory also holds the OFL licence texts and a README,
            # which must not be labelled font/ttf.
            ctype = "font/ttf"
            if fname.endswith(".txt"):
                ctype = "text/plain; charset=utf-8"
            elif fname.endswith(".md"):
                ctype = "text/markdown; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def _send_html_security_headers(self) -> None:
        """Headers common to the two HTML pages.

        Deliberately no Content-Security-Policy: both pages are assembled from
        inline <style>/<script> blocks by _build_html()/_build_display_html(),
        so any CSP without 'unsafe-inline' breaks the product outright — and a
        CSP that allows 'unsafe-inline' buys nothing.
        """
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")

    def _serve_ui(self) -> None:
        html = _build_html()
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self._send_html_security_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_display(self) -> None:
        html = _build_display_html()
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self._send_html_security_headers()
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
