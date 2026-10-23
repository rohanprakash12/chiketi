"""The deploy steps for each part of a site."""

from __future__ import annotations

import datetime
import os
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from chiketi.sites.remote import SSH, apply
from chiketi.sites.render import CONTROL_PORT, FileOut, files_for

REPO = Path(__file__).resolve().parents[2]


def _today() -> str:
    return datetime.date.today().strftime("%Y%m%d")


def _report(results) -> bool:
    for f, status in results:
        print(f"{status:13} {f.host}:{f.path}")
    return any(s in ("changed", "created") for _, s in results)


def _ssh(runner, host, cmd):
    r = runner.run(SSH + [host, cmd])
    if r.returncode != 0:
        raise RuntimeError(f"{host}: {cmd.split('&&')[0].strip()} failed: {r.stderr.strip()}")
    return r


def check_repo(repo) -> None:
    """Deploys copy chiketi from a git checkout (never a live tree): make sure there is one."""
    if not (Path(repo) / ".git").exists():
        raise RepoError(f"{repo} is not a chiketi source checkout; deploy needs one "
                        "(git clone the repository and run chiketi-site from it, or pass --repo DIR)")


class RepoError(Exception):
    pass


def _sha(repo, ref) -> str:
    r = subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "--verify", "--quiet", f"{ref}^{{commit}}"],
                       capture_output=True, text=True, check=False)
    if r.returncode != 0:
        raise RuntimeError(f"{ref!r} is not a commit in {repo}")
    return r.stdout.strip()


def _ensure_dirs(site, runner) -> None:
    # The unit's ReadWritePaths must exist before systemd will start it.
    _ssh(runner, site.server.ssh, "mkdir -p ~/.config/chiketi ~/.local/state/chiketi")


def _restart(runner, host, unit):
    _ssh(runner, host, f"sudo systemctl daemon-reload && sudo systemctl enable {unit} && sudo systemctl restart {unit}")


def deploy_server(site, runner, dry_run, ref="HEAD", repo=REPO) -> int:
    files = files_for(site, "server")
    srv, inst = site.server, site.server.install_dir
    sha = _sha(repo, ref)
    if dry_run:
        running = runner.run(SSH + [srv.ssh, f"cat {inst}/DEPLOYED"]).stdout.strip() or "unknown"
        print(f"software: would install {sha} into {inst} and restart chiketi (running: {running})")
        _report(apply(files, runner, True, _today()))
        return 0
    with tempfile.TemporaryDirectory() as tmp:
        tgz = os.path.join(tmp, "chiketi.tgz")
        subprocess.run(["git", "-C", str(repo), "archive", "--format=tar.gz", "-o", tgz, ref], check=True)
        r = runner.run(["scp", "-q", tgz, f"{srv.ssh}:/tmp/chiketi.tgz"])
        if r.returncode != 0:
            raise RuntimeError(f"copy to {srv.ssh} failed: {r.stderr.strip()}")
    _ssh(runner, srv.ssh, (
        f"set -e; sudo rm -rf {inst}/src.new && sudo mkdir -p {inst}/src.new && "
        f"sudo tar -xzf /tmp/chiketi.tgz -C {inst}/src.new && "
        f"{{ [ -x {inst}/venv/bin/pip ] || sudo python3 -m venv {inst}/venv; }} && "
        f"sudo {inst}/venv/bin/pip install -q --upgrade {inst}/src.new && "
        f"sudo rm -rf {inst}/src && sudo mv {inst}/src.new {inst}/src && "
        f"echo {sha} | sudo tee {inst}/DEPLOYED >/dev/null && rm -f /tmp/chiketi.tgz"))
    _ensure_dirs(site, runner)
    _report(apply(files, runner, False, _today()))
    _restart(runner, srv.ssh, "chiketi")
    url = f"http://{srv.address}:{CONTROL_PORT}/api/health"
    for _ in range(30):
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                if resp.status == 200:
                    print(f"deployed {sha}; {url} answers")
                    return 0
        except OSError:
            time.sleep(1)
    print(f"deployed {sha}, but {url} does not answer")
    return 1


def deploy_display(site, runner, display_id, dry_run, restart_unit=None, repo=REPO) -> int:
    d = site.display(display_id)
    files = files_for(site, "display", d.id)
    if d.kind == "picture":
        comp = Path(repo) / "companions" / "lcd-snap"
        files[1:1] = [
            FileOut(site.server.ssh, "/opt/lcd-snap/lcd_snap.py", (comp / "lcd_snap.py").read_text()),
            FileOut(site.server.ssh, "/etc/apparmor.d/lcd-snap-chrome",
                    (comp / "apparmor-lcd-snap-chrome").read_text()),
        ]
        probe = runner.run(SSH + [site.server.ssh, "test -x /opt/lcd-snap/venv/bin/python"])
        if probe.returncode != 0:
            print("lcd-snap needs Chrome for Testing's headless shell in /opt/lcd-snap/ and a venv with "
                  "websockets (see companions/lcd-snap/README.md)")
    results = apply(files, runner, dry_run, _today())
    changed = _report(results)
    if dry_run or not changed:
        return 0
    if d.kind == "browser":
        _restart(runner, d.ssh, "kiosk")
    else:
        server_changed = any(s in ("changed", "created") and f.host == site.server.ssh for f, s in results)
        if server_changed:
            _ssh(runner, site.server.ssh, "sudo apparmor_parser -r /etc/apparmor.d/lcd-snap-chrome")
            _restart(runner, site.server.ssh, "lcd-snap")
        if restart_unit and d.pusher_ssh:
            _ssh(runner, d.pusher_ssh, f"sudo systemctl restart {restart_unit}")
    return 0


def deploy_feed(site, runner, dry_run) -> int:
    results = apply(files_for(site, "feed"), runner, dry_run, _today())
    if _report(results) and not dry_run:
        _restart(runner, site.feed.ssh, "claude-session-feed")
    return 0


def deploy_probe(site, hosts, dry_run, repo=REPO) -> int:
    hosts = list(hosts) or list(site.probe_hosts)
    for h in hosts:
        print(f"probe: {h}")
        if not dry_run:
            subprocess.run([str(repo / "scripts" / "install-probe.sh"), h],
                           env={**os.environ, "HUB": site.server.ssh}, check=True)
    return 0
