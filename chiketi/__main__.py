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

    sys.exit(run(bind_host=args.bind, token=args.token))


if __name__ == "__main__":
    main()
