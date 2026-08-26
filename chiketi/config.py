"""Timing constants."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Timing:
    collect_interval_ms: int = 1500
    rotate_interval_s: int = 10
    pause_duration_s: int = 30


TIMING = Timing()
