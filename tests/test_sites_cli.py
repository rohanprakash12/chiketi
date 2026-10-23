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
            return subprocess.CompletedProcess(argv, 1, "", "missing")
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
