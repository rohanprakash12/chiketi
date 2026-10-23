"""Put rendered files on machines over ssh: read the current copy, compare, back up, write.
Never deletes anything. A dry run only reads."""

from __future__ import annotations

import difflib
import shlex
import subprocess

from chiketi.sites.render import FileOut

SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]


class Runner:
    def run(self, argv, input=None):
        return subprocess.run(argv, input=input, capture_output=True, text=True, check=False)


def remote_path(path: str) -> str:
    if path.startswith("~/"):
        return '"$HOME"/' + shlex.quote(path[2:])
    return shlex.quote(path)


def _ssh(runner, host: str, cmd: str, input=None):
    return runner.run(SSH + [host, cmd], input=input)


def apply(files: list[FileOut], runner, dry_run: bool, today: str) -> list[tuple[FileOut, str]]:
    results = []
    for f in files:
        rp = remote_path(f.path)
        sudo = "sudo " if f.sudo else ""
        # exit 3 = no such file; any other failure (host down, no sudo) stops the deploy,
        # so an unreadable file is never treated as missing and overwritten without a backup
        cur = _ssh(runner, f.host, f"{sudo}test -e {rp} || exit 3; {sudo}cat {rp}")
        if cur.returncode not in (0, 3):
            raise RuntimeError(f"{f.host}:{f.path}: cannot read: {cur.stderr.strip() or f'exit {cur.returncode}'}")
        exists = cur.returncode == 0
        if exists and cur.stdout == f.content:
            results.append((f, "unchanged"))
            continue
        if dry_run:
            diff = difflib.unified_diff((cur.stdout if exists else "").splitlines(True), f.content.splitlines(True),
                                        f"{f.host}:{f.path} (now)", f"{f.host}:{f.path} (new)")
            print("".join(diff) or f"{f.host}:{f.path}: new file\n")
            results.append((f, "would change" if exists else "would create"))
            continue
        if exists:
            bak = remote_path(f"{f.path}.bak-{today}")
            r = _ssh(runner, f.host, f"{sudo}test -e {bak} || {sudo}cp -p {rp} {bak}")
            if r.returncode != 0:
                raise RuntimeError(f"{f.host}:{f.path}: backup failed: {r.stderr.strip()}")
        tmp = remote_path(f"{f.path}.chiketi-new")
        r = _ssh(runner, f.host, f"{sudo}install -D -m {f.mode} /dev/stdin {tmp} && {sudo}mv -f {tmp} {rp}",
                 input=f.content)
        if r.returncode != 0:
            raise RuntimeError(f"{f.host}:{f.path}: write failed: {r.stderr.strip()}")
        results.append((f, "changed" if exists else "created"))
    return results
