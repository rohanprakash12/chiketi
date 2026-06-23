"""Tests for chiketi.themes public API (no module edits)."""

from __future__ import annotations

import pytest

from chiketi.themes import (
    THEMES,
    Theme,
    get_active_family,
    get_active_theme,
    get_families,
    list_themes,
    on_theme_change,
    set_active_theme,
)

pytestmark = pytest.mark.usefixtures("restore_active_theme")


class TestListThemes:
    def test_returns_all_keys(self):
        keys = list_themes()
        assert set(keys) == set(THEMES.keys())

    def test_known_keys_present(self):
        keys = list_themes()
        assert "Panel/Gold" in keys
        assert "Terminal/hacker" in keys
        assert "Vintage/VFD" in keys


class TestGetFamilies:
    def test_groups_by_family(self):
        families = get_families()
        assert set(families.keys()) == {"Terminal", "Panel", "Vintage"}

    def test_all_themes_accounted_for(self):
        families = get_families()
        total = sum(len(v) for v in families.values())
        assert total == len(THEMES)

    def test_values_are_theme_objects(self):
        families = get_families()
        for theme_list in families.values():
            for t in theme_list:
                assert isinstance(t, Theme)

    def test_panel_family_variants(self):
        families = get_families()
        names = {t.name for t in families["Panel"]}
        assert names == {"Gold", "Teal", "Coral"}


class TestSetActiveTheme:
    def test_valid_family_variant(self):
        assert set_active_theme("Panel/Teal") is True
        assert get_active_theme().name == "Teal"
        assert get_active_family() == "Panel"

    def test_invalid_returns_false(self):
        before = get_active_theme()
        assert set_active_theme("Nope/Nope") is False
        assert get_active_theme() is before

    def test_short_name_resolution_terminal(self):
        # Terminal variants are registered in the short-name map.
        assert set_active_theme("hacker") is True
        assert get_active_theme().name == "hacker"
        assert get_active_family() == "Terminal"

    def test_short_name_only_for_terminal(self):
        # Panel/Vintage variants do NOT get a short-name alias.
        assert set_active_theme("Gold") is False

    def test_family_prefix_panel_gold(self):
        assert set_active_theme("Panel/Gold") is True
        t = get_active_theme()
        assert t.family == "Panel"
        assert t.primary == "#FDCD06"

    def test_all_full_keys_settable(self):
        for key in THEMES:
            assert set_active_theme(key) is True
            assert get_active_theme() is THEMES[key]


class TestThemeChangeCallbacks:
    def test_callback_invoked(self, restore_theme_listeners):
        seen = []
        on_theme_change(lambda t: seen.append(t))
        set_active_theme("Vintage/Tubes")
        assert len(seen) == 1
        assert seen[0].name == "Tubes"

    def test_callback_not_invoked_on_invalid(self, restore_theme_listeners):
        seen = []
        on_theme_change(lambda t: seen.append(t))
        set_active_theme("does/not/exist")
        assert seen == []

    def test_multiple_callbacks(self, restore_theme_listeners):
        a, b = [], []
        on_theme_change(lambda t: a.append(t))
        on_theme_change(lambda t: b.append(t))
        set_active_theme("Panel/Coral")
        assert len(a) == 1 and len(b) == 1


class TestThemeDataclass:
    def test_all_themes_have_required_fields(self):
        for t in THEMES.values():
            for field in ("background", "panel", "border", "primary",
                          "accent", "critical", "dim", "header"):
                val = getattr(t, field)
                assert isinstance(val, str) and val.startswith("#")
