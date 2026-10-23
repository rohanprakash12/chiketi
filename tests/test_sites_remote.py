"""Applying rendered files over ssh: read, compare, back up, write."""
from __future__ import annotations

import subprocess

from chiketi.sites.remote import apply, remote_path
from chiketi.sites.render import FileOut


class FakeRunner:
    def __init__(self, files=None):
        self.files = dict(files or {})       # (host, path) -> content
        self.calls = []
        self.down = set()
        self.no_sudo = False

    def run(self, argv, input=None):
        self.calls.append((argv, input))
        host, cmd = argv[-2], argv[-1]
        if self.no_sudo and cmd.startswith("sudo "):
            # like a real shell: `sudo test ... || exit 3` turns sudo's own failure into exit 3
            # (unless the whole check runs inside one `sudo sh -c '...'`)
            first = cmd.split(";")[0]
            code = 3 if "|| exit 3" in first and not cmd.startswith("sudo sh -c ") else 1
            return subprocess.CompletedProcess(argv, code, "", "sudo: a password is required")
        if host in self.down:
            return subprocess.CompletedProcess(argv, 255, "", "ssh: connect to host: No route to host")
        if "cat " in cmd:
            path = cmd.split("cat ", 1)[1].strip().strip("'")
            key = (host, path.replace('"$HOME"/', "~/"))
            if key in self.files:
                return subprocess.CompletedProcess(argv, 0, self.files[key], "")
            return subprocess.CompletedProcess(argv, 3, "", "")
        return subprocess.CompletedProcess(argv, 0, "", "")


F = FileOut("admin@192.0.2.20", "/etc/systemd/system/kiosk.service", "new\n")


def writes(r):
    return [a for a, _ in r.calls if any(w in a[-1] for w in ("install ", "cp -p", "systemctl"))]


def test_remote_path_quotes_and_expands_home():
    assert remote_path("~/.config/x y.toml") == '"$HOME"/' + "'.config/x y.toml'"
    assert remote_path("/etc/a b") == "'/etc/a b'"


def test_apply_skips_unchanged_file():
    r = FakeRunner({(F.host, F.path): "new\n"})
    assert apply([F], r, dry_run=False, today="20261023")[0][1] == "unchanged"
    assert writes(r) == []


def test_apply_backs_up_then_writes():
    r = FakeRunner({(F.host, F.path): "old\n"})
    assert apply([F], r, dry_run=False, today="20261023")[0][1] == "changed"
    cmds = [a[-1] for a, _ in r.calls]
    assert any("cp -p" in c and ".bak-20261023" in c for c in cmds)
    assert any("install -D -m 644 /dev/stdin" in c and c.startswith("sudo ") for c in cmds)
    assert any(i == "new\n" for _, i in r.calls)


def test_apply_creates_missing_without_backup():
    r = FakeRunner()
    assert apply([F], r, dry_run=False, today="20261023")[0][1] == "created"
    assert not any("cp -p" in a[-1] for a, _ in r.calls)


def test_dry_run_runs_only_reads(capsys):
    r = FakeRunner({(F.host, F.path): "old\n"})
    assert apply([F], r, dry_run=True, today="20261023")[0][1] == "would change"
    assert writes(r) == []
    out = capsys.readouterr().out
    assert "-old" in out and "+new" in out


def test_non_sudo_file_written_as_user():
    f = FileOut("admin@192.0.2.20", "~/kiosk/shell.html", "x", sudo=False)
    r = FakeRunner()
    apply([f], r, dry_run=False, today="20261023")
    w = [a[-1] for a, _ in r.calls if "install " in a[-1]][0]
    assert not w.startswith("sudo ") and '"$HOME"/' in w


def test_unreachable_host_is_an_error_not_a_missing_file():
    import pytest
    r = FakeRunner()
    r.down.add(F.host)
    with pytest.raises(RuntimeError, match="cannot read"):
        apply([F], r, dry_run=True, today="20261023")


def test_read_distinguishes_missing_from_failure():
    r = FakeRunner()
    apply([F], r, dry_run=True, today="20261023")
    read = r.calls[0][0][-1]
    assert "test -e" in read and "exit 3" in read


def test_backup_check_and_write_use_the_same_privileges():
    r = FakeRunner({(F.host, F.path): "old\n"})
    apply([F], r, dry_run=False, today="20261023")
    bak = next(a[-1] for a, _ in r.calls if "cp -p" in a[-1])
    assert bak.startswith("sudo test -e ") and "|| sudo cp -p" in bak


def test_write_is_atomic():
    r = FakeRunner()
    apply([F], r, dry_run=False, today="20261023")
    w = next(a[-1] for a, _ in r.calls if "install " in a[-1])
    assert ".chiketi-new" in w and "&& sudo mv -f " in w


def test_sudo_failure_is_not_a_missing_file():
    import pytest
    r = FakeRunner({(F.host, F.path): "old\n"})
    r.no_sudo = True
    with pytest.raises(RuntimeError, match="cannot read"):
        apply([F], r, dry_run=True, today="20261023")
