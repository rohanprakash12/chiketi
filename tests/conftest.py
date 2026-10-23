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


@pytest.fixture(autouse=True)
def isolate_state(tmp_path, monkeypatch):
    """Keep tests from reading or writing the developer's real state.json.

    Autouse and unconditional: every server test that POSTs now persists
    settings, and chiketi.state.state_path() resolves under XDG_CONFIG_HOME.
    Without this, running the suite would silently rewrite the developer's
    ~/.config/chiketi/state.json.
    """
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    # Also reset the module global that records which theme should be
    # persisted. Any successful theme POST sets it, including ones in test
    # classes that have nothing to do with persistence (the CSRF tests post a
    # theme to check the Origin gate), so resetting it per-class leaves the
    # suite order-dependent. Resetting here makes every test independent.
    # Reset every mutable module global in server.py, not just the ones a
    # given test class remembers to. Per-class teardowns left the suite
    # order-dependent twice: _persisted_theme (set by theme POSTs in the CSRF
    # tests, which are not about persistence at all) and _display_width /
    # _display_height (set by a brightness test, tripping a later persistence
    # test under shuffle seed 7). Doing it centrally means a new test cannot
    # reintroduce the class of bug by forgetting a teardown.
    import chiketi.server as _server
    for _name, _value in (
        ("_persisted_theme", None),
        ("_display_output", ""),
        ("_display_brightness", 1.0),
        ("_display_width", 1024),
        ("_display_height", 600),
        ("_AUTH_TOKEN", None),
        ("_XRANDR_CACHE_TS", 0.0),
    ):
        monkeypatch.setattr(_server, _name, _value, raising=False)
    # Mutable containers need a fresh object, not a shared one.
    monkeypatch.setattr(_server, "_screen_rotation", {}, raising=False)
    monkeypatch.setattr(_server, "_XRANDR_CACHE", [], raising=False)
