"""Tests for chiketi.config constants and the Timing dataclass."""

from __future__ import annotations

import dataclasses

from chiketi import config
from chiketi.config import Timing, TIMING


class TestTimingDefaults:
    def test_default_values(self):
        t = Timing()
        assert t.collect_interval_ms == 1500
        assert t.rotate_interval_s == 10
        assert t.pause_duration_s == 30

    def test_is_frozen(self):
        t = Timing()
        with __import__("pytest").raises(dataclasses.FrozenInstanceError):
            t.collect_interval_ms = 999  # type: ignore[misc]

    def test_singleton_matches_defaults(self):
        assert TIMING == Timing()

    def test_override_values(self):
        t = Timing(collect_interval_ms=500, rotate_interval_s=5, pause_duration_s=15)
        assert t.collect_interval_ms == 500
        assert t.rotate_interval_s == 5
        assert t.pause_duration_s == 15


class TestThresholdConstants:
    def test_display_dimensions(self):
        assert config.DISPLAY_WIDTH == 1024
        assert config.DISPLAY_HEIGHT == 600

    def test_thresholds(self):
        assert config.THRESHOLD_WARNING == 70
        assert config.THRESHOLD_CRITICAL == 90

    def test_warning_below_critical(self):
        assert config.THRESHOLD_WARNING < config.THRESHOLD_CRITICAL
