"""chiketi-site: check, render, deploy (with a fake ssh)."""
from __future__ import annotations

import subprocess

from chiketi.sites.cli import main
from tests.test_sites_model import make


class Recorder:
    def __init__(self, present=None):
        self.present = dict(present or {})
        self.calls = []

    def run(self, argv, input=None):
        self.calls.append(argv)
        cmd = argv[-1] if argv else ""
        if "cat " in cmd:
            return subprocess.CompletedProcess(argv, 3, "", "")   # remote.apply: no such file
        if "test -x /opt/lcd-snap/venv/bin/python" in cmd:
            return subprocess.CompletedProcess(argv, 0, "", "")
        return subprocess.CompletedProcess(argv, 0, "", "")


def test_check_ok_and_errors(tmp_path, capsys):
    root = make(tmp_path)
    assert main(["check", "--site", str(root)]) == 0
    assert "kiosk-1 (browser)" in capsys.readouterr().out
    (root / "site.toml").write_text((root / "site.toml").read_text() + "\n[oops]\nx = 1\n")
    assert main(["check", "--site", str(root)]) == 2
    assert "oops: unknown section" in capsys.readouterr().out


def test_render_prints_file(tmp_path, capsys):
    root = make(tmp_path)
    assert main(["render", "kiosk-page", "--display", "kiosk-1", "--site", str(root)]) == 0
    assert "display?device=kiosk-1" in capsys.readouterr().out


def test_deploy_display_dry_run_writes_nothing(tmp_path):
    rec = Recorder()
    assert main(["deploy", "display", "kiosk-1", "--dry-run", "--site", str(make(tmp_path))], runner=rec) == 0
    assert not any("install " in a[-1] or "systemctl" in a[-1] for a in rec.calls)


def test_deploy_display_restarts_kiosk(tmp_path):
    rec = Recorder()
    assert main(["deploy", "display", "kiosk-1", "--site", str(make(tmp_path))], runner=rec) == 0
    assert any("systemctl restart kiosk" in a[-1] for a in rec.calls)


def test_deploy_feed(tmp_path):
    rec = Recorder()
    assert main(["deploy", "feed", "--site", str(make(tmp_path))], runner=rec) == 0
    assert any("systemctl restart claude-session-feed" in a[-1] for a in rec.calls)


def test_deploy_server_creates_the_service_dirs(tmp_path):
    from chiketi.sites import deploy
    from chiketi.sites.model import load_site
    (tmp_path / "s").mkdir()
    site = load_site(make(tmp_path / "s"))
    rec = Recorder()
    deploy._ensure_dirs(site, rec)
    cmd = rec.calls[-1][-1]
    assert "mkdir -p" in cmd and ".config/chiketi" in cmd and ".local/state/chiketi" in cmd


def test_deploy_needs_a_source_checkout(tmp_path, capsys):
    (tmp_path / "s").mkdir()
    rec = Recorder()
    rc = main(["deploy", "server", "--repo", str(tmp_path), "--site", str(make(tmp_path / "s"))], runner=rec)
    assert rc == 2 and "source checkout" in capsys.readouterr().out and rec.calls == []


def test_server_dry_run_checks_the_ref_and_reports_software(tmp_path, capsys):
    rec = Recorder()
    root = str(make(tmp_path))
    assert main(["deploy", "server", "--dry-run", "--ref", "no-such-ref-xyz", "--site", root], runner=rec) == 1
    assert main(["deploy", "server", "--dry-run", "--site", root], runner=rec) == 0
    assert "software: would install" in capsys.readouterr().out


def test_restart_unit_is_validated(tmp_path, capsys):
    rec = Recorder()
    rc = main(["deploy", "display", "wide-1", "--restart-unit", "x; touch /tmp/p", "--site", str(make(tmp_path))],
              runner=rec)
    assert rc == 2 and rec.calls == []


def test_probe_hosts_from_the_command_line_are_validated(tmp_path):
    assert main(["deploy", "--dry-run", "--site", str(make(tmp_path)), "probe", "--", "-oProxyCommand=x"]) == 2
