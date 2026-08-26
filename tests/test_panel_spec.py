"""Tests for chiketi.panel_spec.web_spec output shape."""

from __future__ import annotations

import json

from chiketi.panel_spec import web_spec


class TestWebSpec:
    def test_top_level_keys(self):
        spec = web_spec()
        for key in ("colors", "coral", "teal", "scanlines", "tubes", "vfd"):
            assert key in spec, f"missing top-level key {key!r}"

    def test_json_serializable(self):
        # Server embeds this via json.dumps; it must round-trip.
        s = json.dumps(web_spec())
        assert json.loads(s) == web_spec()

    def test_colors_section(self):
        colors = web_spec()["colors"]
        assert colors["gold"] == "#FDCD06"
        assert colors["red"] == "#BF0F0F"
        for k in ("thermBlue", "thermGreen", "thermYellow", "thermOrange", "thermDarkRed"):
            assert k in colors

    def test_color_values_are_hex(self):
        colors = web_spec()["colors"]
        for name, val in colors.items():
            assert isinstance(val, str)
            assert val.startswith("#"), f"{name}={val} is not a hex color"
            assert len(val) == 7

    def test_no_sizes_section(self):
        # The px tokens were dropped: no renderer ever read them.
        assert "sizes" not in web_spec()

    def test_teal_palette_keys(self):
        teal = web_spec()["teal"]
        assert teal["teal"] == "#2A9D8F"
        assert teal["navy"] == "#2F3749"

    def test_returns_fresh_dict(self):
        # JS uses PANEL_SPEC.colors.gold etc.; ensure nested dicts exist.
        a = web_spec()
        b = web_spec()
        assert a == b
        assert a is not b
