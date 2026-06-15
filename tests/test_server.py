"""Tests for chiketi.server: pure helpers + a live HTTPServer route smoke test.

Headless: the HTTP server binds to an ephemeral port (port 0) on localhost,
runs in a daemon thread, and is shut down at the end. No display / GPU needed.
"""

from __future__ import annotations

import json
import threading
import urllib.request
from http.server import HTTPServer
from unittest import mock

import pytest

import chiketi.server as server
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
    """Context manager: a real HTTPServer on an ephemeral port in a thread."""

    def __init__(self):
        self.httpd = HTTPServer(("127.0.0.1", 0), ControlHandler)
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
