"""CLI entry point: python -m chiketi."""

from __future__ import annotations

import argparse
import sys

# Bounds for --rotate-interval, matching the clamp the control API already
# applies to per-screen durations (server.py). Below 3s the display thrashes;
# 0 or negative turns the browser's setTimeout(onRotate, ...) into a hot loop.
ROTATE_MIN_S = 3
ROTATE_MAX_S = 600


def build_parser() -> argparse.ArgumentParser:
    """Construct the CLI parser. Split out so tests can exercise it."""
    parser = argparse.ArgumentParser(
        prog="chiketi",
        description="System stats dashboard for 7\" GeeekPi display",
    )
    parser.add_argument(
        "--rotate-interval",
        type=int,
        default=None,
        help=f"Seconds between auto-rotation, {ROTATE_MIN_S}-{ROTATE_MAX_S} (default: 10)",
    )
    parser.add_argument(
        "--theme",
        type=str,
        default=None,
        help="Theme to use (e.g. 'Panel/Gold', 'Terminal/hacker'). Default: Panel/Gold.",
    )
    parser.add_argument(
        "--bind",
        type=str,
        default="0.0.0.0",
        help="Host to bind the control server to. Default: 0.0.0.0 (LAN-reachable). "
             "Use 127.0.0.1 to restrict to localhost.",
    )
    parser.add_argument(
        "--token",
        type=str,
        default=None,
        help="Optional shared secret required on control POSTs (X-Chiketi-Token "
             "header). Can also be set via the CHIKETI_TOKEN env var.",
    )
    return parser


def validate_args(args: argparse.Namespace) -> None:
    """Reject out-of-range values. Exits with status 2, like argparse errors."""
    if args.rotate_interval is not None and not (
        ROTATE_MIN_S <= args.rotate_interval <= ROTATE_MAX_S
    ):
        print(
            f"chiketi: --rotate-interval must be between {ROTATE_MIN_S} and "
            f"{ROTATE_MAX_S} seconds (got {args.rotate_interval})",
            file=sys.stderr,
        )
        raise SystemExit(2)


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    validate_args(args)

    if args.theme:
        from chiketi.themes import set_active_theme
        if not set_active_theme(args.theme):
            print(f"Unknown theme: {args.theme}", file=sys.stderr)
            sys.exit(1)

    if args.rotate_interval is not None:
        from chiketi.config import TIMING
        object.__setattr__(TIMING, 'rotate_interval_s', args.rotate_interval)

    from chiketi.app import run

    sys.exit(run(bind_host=args.bind, token=args.token))


if __name__ == "__main__":
    main()
