"""Tests for chiketi.server: pure helpers + a live HTTPServer route smoke test.

Headless: the HTTP server binds to an ephemeral port (port 0) on localhost,
runs in a daemon thread, and is shut down at the end. No display / GPU needed.
"""

from __future__ import annotations

import json
import os
import socket
import threading
import urllib.request
import urllib.error
from http.server import HTTPServer, ThreadingHTTPServer
from unittest import mock

import pytest

import chiketi.server as server
import chiketi.themes as themes
from chiketi.collectors.base import MetricValue
from chiketi.server import (
    ControlHandler,
    _apply_display_settings,
    _parse_xrandr,
    _serialize_metrics,
    set_metrics_source,
)


XRANDR_SAMPLE = """\
Screen 0: minimum 320 x 200, current 1920 x 1080, maximum 16384 x 16384
HDMI-1 connected primary 1920x1080+0+0 (normal left inverted right) 510mm x 290mm
   1920x1080     60.00*+  74.97
DP-1 disconnected (normal left inverted right)
VGA-1 connected 1024x768+1920+0 (normal) 0mm x 0mm
"""


class TestParseXrandr:
    def test_connected_outputs(self):
        outputs = _parse_xrandr(XRANDR_SAMPLE)
        by_name = {o["name"]: o for o in outputs}
        assert "HDMI-1" in by_name
        assert by_name["HDMI-1"]["connected"] is True
        assert by_name["HDMI-1"]["resolution"] == "1920x1080"

    def test_disconnected_output(self):
        outputs = _parse_xrandr(XRANDR_SAMPLE)
        by_name = {o["name"]: o for o in outputs}
        assert by_name["DP-1"]["connected"] is False
        assert by_name["DP-1"]["resolution"] == ""

    def test_second_connected_resolution(self):
        outputs = _parse_xrandr(XRANDR_SAMPLE)
        by_name = {o["name"]: o for o in outputs}
        assert by_name["VGA-1"]["resolution"] == "1024x768"

    def test_empty_input(self):
        assert _parse_xrandr("") == []

    def test_count(self):
        outputs = _parse_xrandr(XRANDR_SAMPLE)
        assert len(outputs) == 3


class TestSerializeMetrics:
    def teardown_method(self):
        # Reset the module-global metrics getter after each test.
        server._get_metrics = None

    def test_no_source_returns_empty(self):
        server._get_metrics = None
        assert _serialize_metrics() == {}

    def test_serializes_metric_values(self):
        def source():
            return {
                "cpu.usage": MetricValue(value=42.0, unit="%"),
                "gpu.name": MetricValue(available=False),
            }
        set_metrics_source(source)
        out = _serialize_metrics()
        assert out["cpu.usage"] == {
            "value": 42.0, "unit": "%", "available": True, "extra": {},
        }
        assert out["gpu.name"]["available"] is False

    def test_includes_extra(self):
        set_metrics_source(lambda: {
            "mem.ram_used": MetricValue(value=8.0, unit="GiB", extra={"total": 16.0}),
        })
        out = _serialize_metrics()
        assert out["mem.ram_used"]["extra"] == {"total": 16.0}


class TestApplyDisplaySettings:
    def teardown_method(self):
        # _apply_display_settings writes the module globals on success; without
        # this the "HDMI-1"/0.8 pair leaked into every later test, and now that
        # a POST persists those globals to disk the leak would be written out.
        server._display_output = ""
        server._display_brightness = 1.0

    def test_empty_output_returns_false(self):
        assert _apply_display_settings("", 1.0) is False

    def test_valid_output_applies_and_returns_true(self):
        # Regression: _apply_display_settings used to call the undefined
        # _get_display_env(), raising a swallowed NameError so it always
        # returned False. It now uses _get_session_env() (same as the query
        # path) and must actually invoke xrandr and return True.
        with mock.patch.object(server, "_get_session_env",
                               return_value={"DISPLAY": ":0"}), \
                mock.patch.object(server, "subprocess") as msub:
            msub.run.return_value.returncode = 0
            result = _apply_display_settings("HDMI-1", 0.8)
        assert result is True
        msub.run.assert_called_once()
        args, kwargs = msub.run.call_args
        assert args[0] == ["xrandr", "--output", "HDMI-1",
                           "--brightness", "0.8"]
        assert kwargs["env"] == {"DISPLAY": ":0"}
        assert server._display_output == "HDMI-1"
        assert server._display_brightness == 0.8


class _LiveServer:
    """Context manager: a real HTTPServer on an ephemeral port in a thread.

    threaded=True uses ThreadingHTTPServer, which is what start_server()
    actually runs — required to exercise concurrent request handling.
    """

    def __init__(self, threaded=False):
        cls = ThreadingHTTPServer if threaded else HTTPServer
        self.httpd = cls(("127.0.0.1", 0), ControlHandler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)


class TestLiveRoutes:
    def teardown_method(self):
        server._get_metrics = None

    def test_metrics_route_json_shape(self):
        set_metrics_source(lambda: {
            "cpu.usage": MetricValue(value=12.5, unit="%"),
        })
        with _LiveServer() as srv:
            with urllib.request.urlopen(srv.url("/api/metrics"), timeout=5) as resp:
                assert resp.status == 200
                data = json.loads(resp.read())
        assert "cpu.usage" in data
        assert data["cpu.usage"]["value"] == 12.5
        assert data["cpu.usage"]["unit"] == "%"
        assert set(data["cpu.usage"].keys()) == {"value", "unit", "available", "extra"}

    def test_health_route(self):
        with _LiveServer() as srv:
            with urllib.request.urlopen(srv.url("/api/health"), timeout=5) as resp:
                assert resp.status == 200
                data = json.loads(resp.read())
        assert data == {"status": "ok"}

    def test_themes_route_shape(self):
        with _LiveServer() as srv:
            with urllib.request.urlopen(srv.url("/api/themes"), timeout=5) as resp:
                assert resp.status == 200
                data = json.loads(resp.read())
        assert "active_family" in data
        assert "active_variant" in data
        assert "families" in data
        assert isinstance(data["families"], dict)

    def test_404_for_unknown(self):
        with _LiveServer() as srv:
            with pytest.raises(urllib.error.HTTPError) as ei:
                urllib.request.urlopen(srv.url("/no/such/route"), timeout=5)
            assert ei.value.code == 404


class TestControlPlane:
    """Token auth, outputs gating, partial POSTs, failure propagation, bounds."""

    def teardown_method(self):
        server._get_metrics = None
        server._AUTH_TOKEN = None
        server._XRANDR_CACHE = []
        server._XRANDR_CACHE_TS = 0.0
        server._screen_rotation = {}
        server._display_output = ""

    def _post(self, srv, path, body, headers=None):
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            srv.url(path), data=data, method="POST",
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        return urllib.request.urlopen(req, timeout=5)

    def test_token_required_on_post(self):
        server._AUTH_TOKEN = "secret"
        with _LiveServer() as srv:
            with pytest.raises(urllib.error.HTTPError) as ei:
                self._post(srv, "/api/display", {})
            assert ei.value.code == 403

    def test_token_accepted_on_post(self):
        server._AUTH_TOKEN = "secret"
        with _LiveServer() as srv:
            resp = self._post(srv, "/api/display", {},
                              {"X-Chiketi-Token": "secret"})
            assert resp.status == 200

    def test_display_get_omits_outputs_by_default(self):
        with mock.patch.object(
            server, "_query_xrandr_outputs",
            return_value=[{"name": "HDMI-1", "connected": True, "resolution": ""}],
        ):
            with _LiveServer() as srv:
                with urllib.request.urlopen(srv.url("/api/display"), timeout=5) as resp:
                    data = json.loads(resp.read())
        assert "outputs" not in data          # kiosk path doesn't shell out
        assert "default_duration" in data

    def test_display_get_includes_outputs_when_requested(self):
        with mock.patch.object(
            server, "_query_xrandr_outputs",
            return_value=[{"name": "HDMI-1", "connected": True, "resolution": ""}],
        ):
            with _LiveServer() as srv:
                with urllib.request.urlopen(
                        srv.url("/api/display?outputs=1"), timeout=5) as resp:
                    data = json.loads(resp.read())
        assert [o["name"] for o in data["outputs"]] == ["HDMI-1"]

    def test_partial_post_does_not_validate_output(self):
        # A display_on-only POST must not be rejected by stale/empty xrandr.
        server._display_output = "HDMI-1"
        with mock.patch.object(server, "_query_xrandr_outputs", return_value=[]):
            with _LiveServer() as srv:
                resp = self._post(srv, "/api/display", {"display_on": False})
                assert resp.status == 200

    def test_unknown_output_rejected(self):
        with mock.patch.object(
            server, "_query_xrandr_outputs",
            return_value=[{"name": "HDMI-1", "connected": True, "resolution": ""}],
        ):
            with _LiveServer() as srv:
                with pytest.raises(urllib.error.HTTPError) as ei:
                    self._post(srv, "/api/display", {"output": "DP-9"})
                assert ei.value.code == 400

    def test_apply_failure_reported(self):
        with mock.patch.object(
            server, "_query_xrandr_outputs",
            return_value=[{"name": "HDMI-1", "connected": True, "resolution": ""}],
        ), mock.patch.object(server, "_apply_display_settings", return_value=False):
            with _LiveServer() as srv:
                resp = self._post(srv, "/api/display",
                                  {"output": "HDMI-1", "brightness": 1.0})
                data = json.loads(resp.read())
        assert data["applied"] is False

    def test_rotation_duration_clamped(self):
        with _LiveServer() as srv:
            resp = self._post(
                srv, "/api/display",
                {"screen_rotation": {"screen1": {"enabled": True, "duration": 9999}}})
            data = json.loads(resp.read())
        assert data["screen_rotation"]["screen1"]["duration"] == 600

    def test_rotation_long_key_rejected(self):
        """Now a 400 rather than a silent drop.

        Accepting the request and quietly discarding the entry told the client
        its settings had been saved when they had not.
        """
        with _LiveServer() as srv:
            with pytest.raises(urllib.error.HTTPError) as exc:
                self._post(srv, "/api/display",
                           {"screen_rotation": {"x" * 65: {"duration": 10}}})
            assert exc.value.code == 400
        assert server._screen_rotation == {}


class TestXrandrCache:
    def teardown_method(self):
        server._XRANDR_CACHE = []
        server._XRANDR_CACHE_TS = 0.0

    def test_cached_within_ttl(self):
        with mock.patch.object(server, "_query_xrandr_outputs",
                               return_value=[{"name": "HDMI-1"}]) as q:
            a = server._get_xrandr_outputs()
            b = server._get_xrandr_outputs()
        assert a == b == [{"name": "HDMI-1"}]
        assert q.call_count == 1               # second call served from cache

    def test_force_requeries(self):
        with mock.patch.object(server, "_query_xrandr_outputs",
                               return_value=[{"name": "HDMI-1"}]) as q:
            server._get_xrandr_outputs()
            server._get_xrandr_outputs(force=True)
        assert q.call_count == 2


class TestBodyLimits:
    """Content-Length must be validated before rfile.read()."""

    def test_oversized_body_rejected(self):
        with _LiveServer() as srv:
            req = urllib.request.Request(
                srv.url("/api/display"), data=b"{}", method="POST",
                headers={"Content-Length": str(10 * 1024 * 1024)},
            )
            with pytest.raises(urllib.error.HTTPError) as ei:
                urllib.request.urlopen(req, timeout=5)
            assert ei.value.code == 413

    def test_negative_content_length_rejected(self):
        # urllib will not send a negative Content-Length, so speak HTTP directly.
        with _LiveServer() as srv:
            with socket.create_connection(("127.0.0.1", srv.port), timeout=5) as s:
                s.sendall(
                    b"POST /api/display HTTP/1.1\r\n"
                    b"Host: localhost\r\nContent-Length: -1\r\n\r\n"
                )
                s.settimeout(5)
                resp = s.recv(64)
        assert b"400" in resp

    def test_non_numeric_content_length_rejected(self):
        with _LiveServer() as srv:
            with socket.create_connection(("127.0.0.1", srv.port), timeout=5) as s:
                s.sendall(
                    b"POST /api/display HTTP/1.1\r\n"
                    b"Host: localhost\r\nContent-Length: abc\r\n\r\n"
                )
                s.settimeout(5)
                resp = s.recv(64)
        assert b"400" in resp

    def test_malformed_json_rejected(self):
        with _LiveServer() as srv:
            req = urllib.request.Request(
                srv.url("/api/display"), data=b"{not json", method="POST",
                headers={"Content-Type": "application/json"},
            )
            with pytest.raises(urllib.error.HTTPError) as ei:
                urllib.request.urlopen(req, timeout=5)
            assert ei.value.code == 400

    def test_empty_body_still_accepted(self):
        # A bodiless POST is how the control panel toggles themes; it must work.
        with _LiveServer() as srv:
            req = urllib.request.Request(
                srv.url("/api/display"), data=b"", method="POST")
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status == 200


class TestCsrfAndCors:
    """Cross-origin POSTs are drive-by CSRF; same-origin and no-Origin are not."""

    def teardown_method(self):
        server._AUTH_TOKEN = None
        server._screen_rotation = {}

    @pytest.mark.parametrize(
        "origin",
        ["http://[::1", "http://[", "http://[::1]extra", "http://[fe80::1%25eth0"],
    )
    def test_malformed_ipv6_origin_rejected_not_crashed(self, origin):
        """urlparse raises ValueError on these; the header is attacker-supplied.

        An uncaught raise kills the handler thread and drops the connection with
        no HTTP response at all, so a rejection is the only acceptable outcome.
        """
        assert server._origin_allowed(origin, "127.0.0.1:7777") is False

    @pytest.mark.parametrize("depth", [10000, 20000])
    def test_deeply_nested_json_body_gets_400_not_a_crash(self, depth):
        """json.loads raises RecursionError on deep nesting, inside the size cap.

        RecursionError subclasses RuntimeError, so a narrow
        `except (ValueError, UnicodeDecodeError)` lets it escape do_POST,
        killing the handler thread and dropping the connection with zero bytes.
        """
        body = b"[" * depth + b"]" * depth
        assert len(body) < 64 * 1024, "must fit inside the body cap to be meaningful"
        with _LiveServer() as srv:
            with socket.create_connection(("127.0.0.1", srv.port), timeout=10) as s:
                s.sendall(
                    b"POST /api/display HTTP/1.1\r\n"
                    b"Host: " + f"127.0.0.1:{srv.port}".encode() + b"\r\n"
                    b"Content-Type: application/json\r\n"
                    b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
                )
                s.settimeout(10)
                resp = s.recv(128)
        assert resp.startswith(b"HTTP/"), f"connection dropped, no response: {resp!r}"
        assert b"400" in resp, resp

    @pytest.mark.parametrize("verb", [b"GET", b"POST"])
    @pytest.mark.parametrize(
        "target",
        [b"http://[::1", b"http://[", b"http://[::1]extra/x", b"http://[fe80::1%25eth0/y"],
    )
    def test_malformed_request_target_gets_400_not_a_crash(self, verb, target):
        """Absolute-form request targets reach urlparse verbatim.

        Pre-existing: 'GET http://[::1 HTTP/1.1' raised ValueError inside
        do_GET/do_POST, aborting the handler thread and dropping the connection
        with zero bytes rather than answering.
        """
        with _LiveServer() as srv:
            with socket.create_connection(("127.0.0.1", srv.port), timeout=5) as s:
                s.sendall(
                    verb + b" " + target + b" HTTP/1.1\r\n"
                    b"Host: " + f"127.0.0.1:{srv.port}".encode() + b"\r\n"
                    b"Content-Length: 0\r\n\r\n"
                )
                s.settimeout(5)
                resp = s.recv(128)
        assert resp.startswith(b"HTTP/"), f"connection dropped, no response: {resp!r}"
        assert b"400" in resp, resp

    def test_malformed_origin_gets_a_real_http_response(self, restore_active_theme):
        """End-to-end: the server must answer, not drop the connection."""
        with _LiveServer() as srv:
            with socket.create_connection(("127.0.0.1", srv.port), timeout=5) as s:
                s.sendall(
                    b"POST /api/theme/Sci-Fi/DS9 HTTP/1.1\r\n"
                    b"Host: " + f"127.0.0.1:{srv.port}".encode() + b"\r\n"
                    b"Origin: http://[::1\r\n"
                    b"Content-Length: 0\r\n\r\n"
                )
                s.settimeout(5)
                resp = s.recv(128)
        assert resp.startswith(b"HTTP/"), f"no HTTP response: {resp!r}"
        assert b"403" in resp, resp

    def test_cross_origin_post_rejected(self, restore_active_theme):
        with _LiveServer() as srv:
            req = urllib.request.Request(
                srv.url("/api/theme/Sci-Fi/DS9"), data=b"", method="POST",
                headers={"Origin": "https://evil.example"},
            )
            with pytest.raises(urllib.error.HTTPError) as ei:
                urllib.request.urlopen(req, timeout=5)
            assert ei.value.code == 403

    def test_cross_origin_post_does_not_change_state(self, restore_active_theme):
        before = themes.get_active_theme().name
        with _LiveServer() as srv:
            req = urllib.request.Request(
                srv.url("/api/theme/Sci-Fi/DS9"), data=b"", method="POST",
                headers={"Origin": "https://evil.example"},
            )
            with pytest.raises(urllib.error.HTTPError):
                urllib.request.urlopen(req, timeout=5)
        assert themes.get_active_theme().name == before

    def test_same_origin_post_allowed(self, restore_active_theme):
        with _LiveServer() as srv:
            req = urllib.request.Request(
                srv.url("/api/theme/Sci-Fi/DS9"), data=b"", method="POST",
                headers={"Origin": f"http://127.0.0.1:{srv.port}"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status == 200

    def test_post_without_origin_allowed(self, restore_active_theme):
        """curl and scripts send no Origin; they must keep working."""
        with _LiveServer() as srv:
            req = urllib.request.Request(
                srv.url("/api/theme/Sci-Fi/TOS"), data=b"", method="POST")
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status == 200

    def test_null_origin_rejected(self, restore_active_theme):
        """A sandboxed iframe sends Origin: null. Allowing it reopened CSRF."""
        with _LiveServer() as srv:
            req = urllib.request.Request(
                srv.url("/api/theme/Sci-Fi/DS9"), data=b"", method="POST",
                headers={"Origin": "null"})
            with pytest.raises(urllib.error.HTTPError) as exc:
                urllib.request.urlopen(req, timeout=5)
            assert exc.value.code == 403

    def test_metrics_not_wildcard_cors(self):
        with _LiveServer() as srv:
            with urllib.request.urlopen(srv.url("/api/metrics"), timeout=5) as resp:
                assert resp.headers.get("Access-Control-Allow-Origin") != "*"

    def test_same_origin_get_echoes_origin(self):
        with _LiveServer() as srv:
            origin = f"http://127.0.0.1:{srv.port}"
            req = urllib.request.Request(
                srv.url("/api/metrics"), headers={"Origin": origin})
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.headers.get("Access-Control-Allow-Origin") == origin
                assert resp.headers.get("Vary") == "Origin"

    def test_cross_origin_get_gets_no_cors_header(self):
        with _LiveServer() as srv:
            req = urllib.request.Request(
                srv.url("/api/metrics"), headers={"Origin": "https://evil.example"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.headers.get("Access-Control-Allow-Origin") is None

    def test_security_headers_on_json(self):
        with _LiveServer() as srv:
            with urllib.request.urlopen(srv.url("/api/health"), timeout=5) as resp:
                assert resp.headers.get("X-Content-Type-Options") == "nosniff"
                assert resp.headers.get("Referrer-Policy") == "no-referrer"

    def test_security_headers_on_html_pages(self):
        for path in ("/", "/display"):
            with _LiveServer() as srv:
                with urllib.request.urlopen(srv.url(path), timeout=5) as resp:
                    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
                    assert resp.headers.get("Referrer-Policy") == "no-referrer"
                    assert resp.headers.get("X-Frame-Options") == "DENY"


class TestHostAllowed:
    """DNS rebinding: the Origin check cannot stop it, because a rebinding
    attacker controls the DNS name and so Origin and Host agree. What they
    cannot forge is a Host the user would have had to type - an IP literal or
    a private DNS zone. Every real access path is on the allowed side.
    """

    @pytest.mark.parametrize("host", [
        "192.168.16.159:7777",   # LAN address
        "100.94.12.7:7777",      # Tailscale 100.64/10
        "127.0.0.1:7777",
        "[::1]:7777",            # IPv6 literal, bracketed
        "[fd00::1]:7777",        # ULA over Tailscale/IPv6 LAN
        "localhost:7777",
        "LocalHost:7777",        # Host is case-insensitive
        "chiketi.local:7777",    # mDNS
        "box.tail1234.ts.net",   # Tailscale MagicDNS, no port
        "nas.home.arpa:7777",    # RFC 8375
        "pi.lan:7777",
        "svc.internal:7777",
        "microsoft:7777",        # single label cannot be a public domain
        "",                      # absent: non-browser client
    ])
    def test_real_access_paths_allowed(self, host):
        assert server._host_allowed(host) is True

    @pytest.mark.parametrize("host", [
        "evil.example:7777",
        "attacker.co.uk:7777",
        "rebind.evil.com",
        "chiketi.local.evil.com:7777",   # suffix must anchor at the end
        "ts.net.evil.com:7777",
        "[::1:7777",                     # unclosed bracket
        "a]b.com:7777",
    ])
    def test_rebinding_hosts_rejected(self, host):
        assert server._host_allowed(host) is False

    def test_get_rejects_rebinding_host(self):
        """The disclosure half of the attack is a GET: /api/metrics carries
        hostname, LAN IP, MAC and token usage."""
        with _LiveServer() as srv:
            req = urllib.request.Request(srv.url("/api/metrics"))
            req.add_header("Host", "evil.example:7777")
            with pytest.raises(urllib.error.HTTPError) as exc:
                urllib.request.urlopen(req, timeout=5)
            assert exc.value.code == 403

    def test_post_rejects_rebinding_host(self, restore_active_theme):
        """Origin and Host agree, which is exactly what rebinding produces."""
        with _LiveServer() as srv:
            req = urllib.request.Request(srv.url("/api/display/off"), method="POST")
            req.add_header("Host", "evil.example:7777")
            req.add_header("Origin", "http://evil.example:7777")
            with pytest.raises(urllib.error.HTTPError) as exc:
                urllib.request.urlopen(req, timeout=5)
            assert exc.value.code == 403

    def test_lan_access_still_works(self):
        """The whole point: locking out rebinding must not lock out the user."""
        with _LiveServer() as srv:
            req = urllib.request.Request(srv.url("/api/metrics"))
            req.add_header("Host", "192.168.16.159:7777")
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status == 200

    def test_cors_header_not_echoed_to_rebinding_host(self):
        with _LiveServer() as srv:
            req = urllib.request.Request(srv.url("/api/metrics"))
            req.add_header("Host", "evil.example:7777")
            req.add_header("Origin", "http://evil.example:7777")
            with pytest.raises(urllib.error.HTTPError) as exc:
                urllib.request.urlopen(req, timeout=5)
            assert exc.value.headers.get("Access-Control-Allow-Origin") is None


class TestOriginAllowed:
    def test_absent_origin(self):
        assert server._origin_allowed("", "host:7777") is True

    def test_null_origin(self):
        # "null" is not the same as absent: a sandboxed iframe sends it, so
        # allowing it handed the CSRF bypass to any page that embeds one.
        # curl and friends send NO Origin, which is still allowed.
        assert server._origin_allowed("null", "host:7777") is False

    def test_matching_origin(self):
        assert server._origin_allowed("http://host:7777", "host:7777") is True

    def test_port_mismatch(self):
        assert server._origin_allowed("http://host:80", "host:7777") is False

    def test_host_mismatch(self):
        assert server._origin_allowed("http://evil:7777", "host:7777") is False

    def test_opaque_origin(self):
        assert server._origin_allowed("not-a-url", "host:7777") is False


class TestConcurrentState:
    """ThreadingHTTPServer serves requests concurrently; shared display state
    must not be serialized while another thread mutates it."""

    def teardown_method(self):
        server._screen_rotation = {}
        server._display_width = 1024
        server._display_height = 600

    def test_concurrent_get_and_post_do_not_race(self):
        errors = []

        with _LiveServer(threaded=True) as srv:
            def hammer_post():
                for i in range(60):
                    body = json.dumps({
                        "screen_rotation": {
                            f"s{i}": {"enabled": True, "duration": 5}},
                        "width": 1024 + (i % 3),
                        "height": 600 + (i % 3),
                    }).encode()
                    try:
                        req = urllib.request.Request(
                            srv.url("/api/display"), data=body, method="POST",
                            headers={"Content-Type": "application/json"},
                        )
                        urllib.request.urlopen(req, timeout=10).read()
                    except Exception as exc:
                        errors.append(exc)

            def hammer_get():
                for _ in range(60):
                    try:
                        urllib.request.urlopen(
                            srv.url("/api/display"), timeout=10).read()
                    except Exception as exc:
                        errors.append(exc)

            threads = [threading.Thread(target=hammer_post) for _ in range(2)]
            threads += [threading.Thread(target=hammer_get) for _ in range(4)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=60)
        assert not errors, f"concurrent access raised: {errors[:3]}"

    def test_rotation_cap_holds_under_concurrency(self):
        with _LiveServer(threaded=True) as srv:
            def hammer():
                for i in range(120):
                    body = json.dumps({
                        "screen_rotation": {
                            f"k{i}": {"enabled": True, "duration": 5}},
                    }).encode()
                    req = urllib.request.Request(
                        srv.url("/api/display"), data=body, method="POST",
                        headers={"Content-Type": "application/json"},
                    )
                    urllib.request.urlopen(req, timeout=10).read()

            threads = [threading.Thread(target=hammer) for _ in range(6)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=60)
        assert len(server._screen_rotation) <= server._MAX_SCREEN_ROTATION

    def _post_in_thread(self, srv, done, body):
        def run():
            try:
                req = urllib.request.Request(
                    srv.url("/api/display"), data=json.dumps(body).encode(),
                    method="POST", headers={"Content-Type": "application/json"},
                )
                urllib.request.urlopen(req, timeout=20).read()
            finally:
                done.set()
        t = threading.Thread(target=run, daemon=True)
        t.start()
        return t

    def test_post_write_path_takes_the_state_lock(self):
        """Holding _STATE_LOCK must block a concurrent state-mutating POST."""
        with _LiveServer(threaded=True) as srv:
            done = threading.Event()
            with server._STATE_LOCK:
                t = self._post_in_thread(
                    srv, done,
                    {"screen_rotation": {"lk": {"enabled": True, "duration": 7}}})
                assert not done.wait(1.0), "POST completed while lock was held"
            assert done.wait(10), "POST did not complete after lock release"
            t.join(timeout=5)
        assert server._screen_rotation["lk"]["duration"] == 7

    def test_get_read_path_takes_the_state_lock(self):
        """Holding _STATE_LOCK must block a concurrent /api/display GET."""
        with _LiveServer(threaded=True) as srv:
            done = threading.Event()

            def run():
                try:
                    urllib.request.urlopen(
                        srv.url("/api/display"), timeout=20).read()
                finally:
                    done.set()

            with server._STATE_LOCK:
                t = threading.Thread(target=run, daemon=True)
                t.start()
                assert not done.wait(1.0), "GET completed while lock was held"
            assert done.wait(10), "GET did not complete after lock release"
            t.join(timeout=5)


class TestDisplayPayloadSnapshot:
    """Deterministic counterpart to the race test: the payload must be a
    detached copy, so json.dumps never iterates the live dict."""

    def teardown_method(self):
        server._screen_rotation = {}

    def test_rotation_is_a_copy(self):
        server._screen_rotation = {"s1": {"enabled": True, "duration": 5}}
        payload = server._display_payload(False)
        assert payload["screen_rotation"] is not server._screen_rotation
        assert payload["screen_rotation"]["s1"] is not server._screen_rotation["s1"]

    def test_later_mutation_does_not_affect_snapshot(self):
        server._screen_rotation = {"s1": {"enabled": True, "duration": 5}}
        payload = server._display_payload(False)
        server._screen_rotation["s2"] = {"enabled": False, "duration": 9}
        server._screen_rotation["s1"]["duration"] = 99
        assert payload["screen_rotation"] == {"s1": {"enabled": True, "duration": 5}}

    def test_display_on_is_passed_in_not_looked_up(self):
        assert server._display_payload(True)["display_on"] is True
        assert server._display_payload(False)["display_on"] is False


class TestBrightnessPersistence:
    """Brightness must be stored independently of whether xrandr applied it."""

    def teardown_method(self):
        server._display_brightness = 1.0
        server._display_output = ""
        server._XRANDR_CACHE = []
        server._XRANDR_CACHE_TS = 0.0

    def _post(self, srv, body):
        req = urllib.request.Request(
            srv.url("/api/display"), data=json.dumps(body).encode(),
            method="POST", headers={"Content-Type": "application/json"},
        )
        return urllib.request.urlopen(req, timeout=5)

    def test_brightness_persists_without_output(self):
        server._display_brightness = 1.0
        with _LiveServer() as srv:
            with self._post(srv, {"brightness": 1.7}) as r:
                assert json.loads(r.read())["brightness"] == 1.7
            with urllib.request.urlopen(srv.url("/api/display"), timeout=5) as r:
                assert json.loads(r.read())["brightness"] == 1.7

    def test_brightness_still_clamped(self):
        with _LiveServer() as srv:
            with self._post(srv, {"brightness": 99}) as r:
                assert json.loads(r.read())["brightness"] == 2.0
            with self._post(srv, {"brightness": -5}) as r:
                assert json.loads(r.read())["brightness"] == 0.3

    def test_omitted_brightness_leaves_stored_value(self):
        server._display_brightness = 1.4
        with _LiveServer() as srv:
            with self._post(srv, {"width": 800, "height": 480}) as r:
                assert json.loads(r.read())["brightness"] == 1.4

    def test_saved_even_when_xrandr_fails(self):
        with mock.patch.object(
            server, "_query_xrandr_outputs",
            return_value=[{"name": "HDMI-1", "connected": True, "resolution": ""}],
        ), mock.patch.object(server, "_apply_display_settings", return_value=False):
            with _LiveServer() as srv:
                with self._post(
                        srv, {"output": "HDMI-1", "brightness": 1.9}) as r:
                    data = json.loads(r.read())
        assert data["applied"] is False
        assert data["applied_detail"] == "saved, but xrandr could not apply it"
        assert data["brightness"] == 1.9

    def test_applied_detail_on_success(self):
        with mock.patch.object(
            server, "_query_xrandr_outputs",
            return_value=[{"name": "HDMI-1", "connected": True, "resolution": ""}],
        ), mock.patch.object(server, "_apply_display_settings", return_value=True):
            with _LiveServer() as srv:
                with self._post(
                        srv, {"output": "HDMI-1", "brightness": 1.2}) as r:
                    data = json.loads(r.read())
        assert data["applied"] is True
        assert data["applied_detail"] == "brightness applied via xrandr"


class TestPersistence:
    """Settings survive a restart; a save failure never fails the request."""

    def teardown_method(self):
        server._display_output = ""
        server._display_brightness = 1.0
        server._display_width = 1024
        server._display_height = 600
        server._screen_rotation = {}
        server._persisted_theme = None
        server._XRANDR_CACHE = []
        server._XRANDR_CACHE_TS = 0.0

    def _post(self, srv, path, body):
        req = urllib.request.Request(
            srv.url(path), data=json.dumps(body).encode(),
            method="POST", headers={"Content-Type": "application/json"},
        )
        return urllib.request.urlopen(req, timeout=5)

    @staticmethod
    def _on_disk() -> dict:
        from chiketi.state import state_path
        with open(state_path(), encoding="utf-8") as fh:
            return json.load(fh)

    def test_display_post_writes_state_file(self):
        with _LiveServer() as srv:
            with self._post(srv, "/api/display", {
                "brightness": 1.6,
                "width": 800, "height": 480,
                "screen_rotation": {"cpu": {"enabled": False, "duration": 25}},
            }) as r:
                assert r.status == 200
        saved = self._on_disk()
        assert saved["brightness"] == 1.6
        assert saved["width"] == 800
        assert saved["height"] == 480
        assert saved["screen_rotation"] == {"cpu": {"enabled": False, "duration": 25}}

    def test_theme_post_writes_state_file(self, restore_active_theme):
        with _LiveServer() as srv:
            with self._post(srv, "/api/theme/Vintage/VFD", {}) as r:
                assert r.status == 200
        assert self._on_disk()["theme"] == "Vintage/VFD"

    def test_short_theme_name_persists_canonical_key(self, restore_active_theme):
        with _LiveServer() as srv:
            with self._post(srv, "/api/theme/hacker", {}) as r:
                assert r.status == 200
        assert self._on_disk()["theme"] == "Terminal/hacker"

    def test_rejected_theme_is_not_persisted(self, restore_active_theme):
        with _LiveServer() as srv:
            with pytest.raises(urllib.error.HTTPError) as ei:
                self._post(srv, "/api/theme/Nope/Nope", {})
            assert ei.value.code == 400
        from chiketi.state import state_path
        assert not os.path.exists(state_path())

    def test_settings_survive_a_restart(self, restore_active_theme):
        """POST settings, wipe every global as a process restart would, reload."""
        with _LiveServer() as srv:
            self._post(srv, "/api/theme/Sci-Fi/DS9", {}).close()
            self._post(srv, "/api/display", {
                "brightness": 1.9, "width": 1280, "height": 720,
                "screen_rotation": {"net": {"enabled": True, "duration": 30}},
            }).close()

        # --- simulate the restart ---
        self.teardown_method()
        themes.set_active_theme("Sci-Fi/TOS")

        from chiketi.state import load_state
        saved = load_state()
        themes.set_active_theme(saved["theme"])
        server.apply_saved_state(saved)

        assert themes.get_active_theme().name == "DS9"
        assert server._display_brightness == 1.9
        assert server._display_width == 1280
        assert server._display_height == 720
        assert server._screen_rotation == {"net": {"enabled": True, "duration": 30}}

        with _LiveServer() as srv:
            with urllib.request.urlopen(srv.url("/api/display"), timeout=5) as r:
                payload = json.loads(r.read())
        assert payload["brightness"] == 1.9
        assert payload["screen_rotation"] == {"net": {"enabled": True, "duration": 30}}

    def test_save_failure_does_not_fail_the_request(self):
        """A read-only HOME is supported: the panel keeps working."""
        with mock.patch("chiketi.state.save_state", return_value=False) as ms:
            with _LiveServer() as srv:
                with self._post(srv, "/api/display", {"brightness": 1.3}) as r:
                    assert r.status == 200
                    assert json.loads(r.read())["brightness"] == 1.3
        assert ms.called

    def test_save_raising_does_not_fail_the_request(self):
        with mock.patch("chiketi.state.save_state", side_effect=RuntimeError("boom")):
            with _LiveServer() as srv:
                with self._post(srv, "/api/display", {"brightness": 1.3}) as r:
                    assert r.status == 200

    def test_cli_theme_is_not_written_back(self, restore_active_theme):
        """A one-off --theme must not become permanent via an unrelated POST."""
        # State as app.run() leaves it: file says Sci-Fi/DS9, --theme forced VFD.
        server.apply_saved_state({"theme": "Sci-Fi/DS9"})
        themes.set_active_theme("Vintage/VFD")
        with _LiveServer() as srv:
            self._post(srv, "/api/display", {"brightness": 1.1}).close()
        saved = self._on_disk()
        assert saved["theme"] == "Sci-Fi/DS9"
        assert saved["brightness"] == 1.1
        # ...but an explicit theme change from the panel does stick.
        with _LiveServer() as srv:
            self._post(srv, "/api/theme/Terminal/amber", {}).close()
        assert self._on_disk()["theme"] == "Terminal/amber"

    def test_persist_falls_back_to_active_theme(self, restore_active_theme):
        """No apply_saved_state() call (bare start_server): record what's live."""
        themes.set_active_theme("Vintage/Tubes")
        with _LiveServer() as srv:
            self._post(srv, "/api/display", {"brightness": 1.2}).close()
        assert self._on_disk()["theme"] == "Vintage/Tubes"

    def test_apply_saved_state_accepts_defaults(self):
        from chiketi.state import DEFAULT_STATE
        server.apply_saved_state(dict(DEFAULT_STATE))
        assert server._display_brightness == 1.0
        assert server._display_output == ""
        assert (server._display_width, server._display_height) == (1024, 600)
        assert server._screen_rotation == {}

    @pytest.mark.parametrize("junk", [None, 5, "x", [], {"theme": 7, "width": "wide"}])
    def test_apply_saved_state_never_raises(self, junk):
        server.apply_saved_state(junk)
        assert server._display_width == 1024

    def test_apply_saved_state_detaches_rotation(self):
        saved = {"screen_rotation": {"cpu": {"enabled": True, "duration": 7}}}
        server.apply_saved_state(saved)
        server._screen_rotation["cpu"]["duration"] = 99
        assert saved["screen_rotation"]["cpu"]["duration"] == 7


class TestDisplayDimensionClamp:
    """The POST path clamps width/height independently of state._sanitize.

    A mutation removing this clamp survived the whole suite: the persisted
    file stayed clamped by the state layer, but the live in-memory value --
    what /api/display reports and what the kiosk page sizes itself to -- did
    not.
    """

    @pytest.mark.parametrize(
        "sent_w,sent_h,want_w,want_h",
        [
            (99999, 99999, 3840, 2160),   # above the ceiling
            (1, 1, 320, 200),             # below the floor
            (-5, -5, 320, 200),           # negative
            (1280, 720, 1280, 720),       # in range, untouched
            (320, 200, 320, 200),         # exactly the floor
            (3840, 2160, 3840, 2160),     # exactly the ceiling
        ],
    )
    def test_live_dimensions_are_clamped(self, sent_w, sent_h, want_w, want_h):
        body = json.dumps({"width": sent_w, "height": sent_h}).encode()
        with _LiveServer() as srv:
            req = urllib.request.Request(
                srv.url("/api/display"), data=body, method="POST",
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                payload = json.loads(resp.read())
        # Both the response and the live globals must reflect the clamp.
        assert (payload["width"], payload["height"]) == (want_w, want_h)
        assert (server._display_width, server._display_height) == (want_w, want_h)


class TestTokenComparisonAndContentTypes:
    def test_token_gate_still_works_after_constant_time_switch(self):
        server._AUTH_TOKEN = "s3cret"
        with _LiveServer() as srv:
            for token, want in [(None, 403), ("wrong", 403), ("s3cret", 200)]:
                headers = {"X-Chiketi-Token": token} if token else {}
                req = urllib.request.Request(
                    srv.url("/api/theme/Sci-Fi/TOS"), data=b"", method="POST",
                    headers=headers,
                )
                try:
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        got = resp.status
                except urllib.error.HTTPError as exc:
                    got = exc.code
                assert got == want, f"token={token!r} -> {got}, expected {want}"

    def test_absent_token_header_does_not_raise(self):
        """compare_digest rejects None, so the header must be coerced."""
        server._AUTH_TOKEN = "s3cret"
        with _LiveServer() as srv:
            req = urllib.request.Request(
                srv.url("/api/theme/Sci-Fi/TOS"), data=b"", method="POST"
            )
            with pytest.raises(urllib.error.HTTPError) as exc:
                urllib.request.urlopen(req, timeout=5)
            assert exc.value.code == 403

    @pytest.mark.parametrize(
        "fname,want",
        [
            ("Rajdhani-Regular.ttf", "font/ttf"),
            ("OFL-Rajdhani.txt", "text/plain; charset=utf-8"),
            ("README.md", "text/markdown; charset=utf-8"),
        ],
    )
    def test_font_dir_content_types(self, fname, want):
        with _LiveServer() as srv:
            with urllib.request.urlopen(
                srv.url(f"/assets/fonts/{fname}"), timeout=5
            ) as resp:
                assert resp.status == 200
                assert resp.headers.get("Content-Type") == want


class TestRejectedPostLeavesStateAlone:
    """Every 400 must leave live state exactly as it was.

    The handler used to validate and mutate interleaved, so a body whose LATER
    field was bad returned 400 having already committed the earlier ones - a
    rejected request could still change your brightness.
    """

    def _snapshot(self):
        return (server._display_brightness, server._display_width,
                server._display_height, dict(server._screen_rotation))

    @pytest.mark.parametrize("bad", [
        {"brightness": 1.7, "width": "abc", "height": 600},
        {"brightness": 1.7, "screen_rotation": {"s": {"duration": "soon"}}},
        {"brightness": 1.7, "width": 800},                        # height missing
        {"brightness": 1.7, "screen_rotation": {"s": "not-an-object"}},
        {"brightness": 1.7, "screen_rotation": "not-an-object"},
        {"brightness": 1.7, "screen_rotation": {"": {"duration": 5}}},
        {"brightness": 1.7, "display_on": "yes"},                 # string bool
        {"brightness": True},                                     # bool as number
        {"brightness": float("inf")},
        {"brightness": float("nan")},
        {"width": 800, "height": 600, "display_on": 1},           # int as bool
    ])
    def test_bad_request_changes_nothing(self, bad):
        server._display_brightness, server._display_width = 1.0, 1024
        server._display_height, server._screen_rotation = 600, {}
        before = self._snapshot()
        with _LiveServer() as srv:
            body = json.dumps(bad).encode()
            req = urllib.request.Request(
                srv.url("/api/display"), data=body, method="POST",
                headers={"Content-Type": "application/json"})
            with pytest.raises(urllib.error.HTTPError) as exc:
                urllib.request.urlopen(req, timeout=5)
            assert exc.value.code == 400
        assert self._snapshot() == before, f"{bad} mutated state despite 400"

    def test_a_good_request_still_commits(self):
        server._display_brightness, server._display_width = 1.0, 1024
        server._display_height, server._screen_rotation = 600, {}
        with _LiveServer() as srv:
            body = json.dumps({"brightness": 1.6, "width": 800, "height": 480,
                               "screen_rotation": {"screen1": {"enabled": False,
                                                               "duration": 30}}}).encode()
            req = urllib.request.Request(
                srv.url("/api/display"), data=body, method="POST",
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as r:
                assert r.status == 200
        assert server._display_brightness == 1.6
        assert (server._display_width, server._display_height) == (800, 480)
        assert server._screen_rotation["screen1"] == {"enabled": False, "duration": 30}


class TestTokenHeaderCannotCrash:
    """hmac.compare_digest raises TypeError on non-ASCII str arguments.

    The header is attacker-supplied, and the call sat outside any try block, so
    a token header of "sécret" killed the handler thread and dropped the
    connection with zero bytes.
    """

    def teardown_method(self):
        server._AUTH_TOKEN = None

    @pytest.mark.parametrize("tok", ["sécret", "日本語", "\U0001f600", "s\udcffcret"])
    def test_non_ascii_token_is_rejected_not_fatal(self, tok):
        server._AUTH_TOKEN = "s3cret"
        with _LiveServer() as srv:
            with socket.create_connection(("127.0.0.1", srv.port), timeout=5) as s:
                s.sendall(
                    b"POST /api/theme/Sci-Fi/DS9 HTTP/1.1\r\n"
                    b"Host: " + f"127.0.0.1:{srv.port}".encode() + b"\r\n"
                    b"X-Chiketi-Token: " + tok.encode("utf-8", "surrogatepass") + b"\r\n"
                    b"Content-Length: 0\r\n\r\n")
                s.settimeout(5)
                resp = s.recv(128)
        assert resp.startswith(b"HTTP/"), f"connection dropped: {resp!r}"
        assert b"403" in resp, resp

    def test_correct_token_still_works(self):
        server._AUTH_TOKEN = "s3cret"
        assert server._token_matches("s3cret") is True
        assert server._token_matches("wrong") is False
        assert server._token_matches(None) is False
