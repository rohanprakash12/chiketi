"""Shared fixtures for the chiketi test suite.

All tests are headless: no display, GPU, or network access is required.
External dependencies (psutil, nvml, HTTP) are mocked at the call site.
"""

from __future__ import annotations

import os

import pytest

import chiketi.themes as themes


@pytest.fixture
def restore_active_theme():
    """Snapshot and restore the module-global active theme.

    themes.py keeps the active theme as a module global; tests that mutate it
    must restore it so they don't leak state into other tests.
    """
    saved = themes._active_theme
    yield
    themes._active_theme = saved


@pytest.fixture
def restore_theme_listeners():
    """Snapshot and restore the theme-change listener list."""
    saved = list(themes._listeners)
    yield
    themes._listeners[:] = saved


FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
