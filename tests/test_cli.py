"""Tests for the chiketi CLI entry point."""

from __future__ import annotations

import pytest

from chiketi.__main__ import build_parser, validate_args


class TestRotateInterval:
    @pytest.mark.parametrize("value", [3, 10, 600])
    def test_accepts_in_range(self, value):
        args = build_parser().parse_args(["--rotate-interval", str(value)])
        validate_args(args)  # must not raise

    @pytest.mark.parametrize("value", [0, -1, 2, 601, 100000])
    def test_rejects_out_of_range(self, value):
        args = build_parser().parse_args(["--rotate-interval", str(value)])
        with pytest.raises(SystemExit) as exc:
            validate_args(args)
        assert exc.value.code == 2

    def test_none_is_allowed(self):
        args = build_parser().parse_args([])
        assert args.rotate_interval is None
        validate_args(args)


class TestDefaults:
    """The no-argument invocation must keep binding 0.0.0.0 with no token."""

    def test_no_args_defaults_unchanged(self):
        args = build_parser().parse_args([])
        assert args.bind == "0.0.0.0"
        assert args.token is None
        assert args.theme is None
