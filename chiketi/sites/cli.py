"""chiketi-site: check, render and deploy a site (a folder of config files)."""

from __future__ import annotations

import argparse
import os
import re
import sys

from chiketi.sites import deploy
from chiketi.sites.model import SAFE, SiteError, load_site
from chiketi.sites.remote import Runner
from chiketi.sites.render import PARTS, render_part

UNIT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9@._:-]*$")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="chiketi-site", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("check", "render", "deploy"):
        s = sub.add_parser(name)
        s.add_argument("--site", default=os.environ.get("CHIKETI_SITE"), help="site folder (or CHIKETI_SITE)")
        if name == "render":
            s.add_argument("part", choices=PARTS)
            s.add_argument("--display")
        if name == "deploy":
            s.add_argument("what", choices=("server", "display", "feed", "probe"))
            s.add_argument("ids", nargs="*", help="display id, or probe hosts")
            s.add_argument("--dry-run", action="store_true")
            s.add_argument("--ref", default="HEAD")
            s.add_argument("--restart-unit")
            s.add_argument("--repo", default=str(deploy.REPO), help="chiketi source checkout to deploy from")
    return p


def main(argv=None, runner=None) -> int:
    args = build_parser().parse_args(argv)
    if not args.site:
        print("chiketi-site: give --site DIR or set CHIKETI_SITE")
        return 2
    try:
        site = load_site(args.site)
    except SiteError as e:
        print(f"chiketi-site: {args.site} has problems:")
        for p in e.problems:
            print(f"  - {p}")
        return 2
    if args.cmd == "deploy":
        if args.restart_unit is not None and not UNIT.match(args.restart_unit):
            print(f"chiketi-site: --restart-unit {args.restart_unit!r} is not a systemd unit name")
            return 2
        bad = [h for h in (args.ids if args.what == "probe" else []) if h.startswith("-") or not SAFE.match(h)]
        if bad:
            print(f"chiketi-site: not an ssh destination: {', '.join(bad)}")
            return 2
        if args.what != "feed":
            try:
                deploy.check_repo(args.repo)
            except deploy.RepoError as exc:
                print(f"chiketi-site: {exc}")
                return 2
    runner = runner or Runner()
    try:
        if args.cmd == "check":
            disp = ", ".join(f"{d.id} ({d.kind})" for d in site.displays) or "none"
            feed = site.feed.ssh if site.feed else "none"
            print(f"site {site.name}: server {site.server.address}; displays: {disp}; "
                  f"session feed on {feed}; probe hosts: {len(site.probe_hosts)}")
            return 0
        if args.cmd == "render":
            sys.stdout.write(render_part(site, args.part, args.display).content)
            return 0
        if args.what == "server":
            return deploy.deploy_server(site, runner, args.dry_run, args.ref, args.repo)
        if args.what == "display":
            if len(args.ids) != 1:
                print("chiketi-site: deploy display needs one display id")
                return 2
            return deploy.deploy_display(site, runner, args.ids[0], args.dry_run, args.restart_unit, args.repo)
        if args.what == "feed":
            return deploy.deploy_feed(site, runner, args.dry_run)
        return deploy.deploy_probe(site, args.ids, args.dry_run, args.repo)
    except (KeyError, RuntimeError) as exc:
        print(f"chiketi-site: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
