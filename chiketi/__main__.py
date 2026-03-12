"""CLI entry point: python -m chiketi."""

from __future__ import annotations

import argparse
import sys


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="chiketi",
        description="System stats dashboard for 7\" GeeekPi display",
    )
    parser.add_argument(
        "--rotate-interval",
        type=int,
        default=None,
        help="Seconds between auto-rotation (default: 10)",
    )
    parser.add_argument(
        "--screen",
        type=str,
        default=None,
        help="Target screen name substring (e.g. 'HDMI'). Sets DISPLAY if needed.",
    )
    parser.add_argument(
        "--theme",
        type=str,
        default=None,
        help="Theme to use (e.g. 'Panel/Gold', 'Terminal/hacker'). Default: Panel/Gold.",
    )

    args = parser.parse_args()

    if args.theme:
        from chiketi.themes import set_active_theme
        if not set_active_theme(args.theme):
            print(f"Unknown theme: {args.theme}", file=sys.stderr)
            sys.exit(1)

    if args.rotate_interval is not None:
        from chiketi.config import TIMING
        object.__setattr__(TIMING, 'rotate_interval_s', args.rotate_interval)

    from chiketi.app import run

    sys.exit(run(target_screen=args.screen))


if __name__ == "__main__":
    main()
