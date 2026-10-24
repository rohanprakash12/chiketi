# tests/test_homelab_probe_script.py
"""The real probe script, run on this machine. Linux only."""
from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
import textwrap

import pytest

PROBE = os.path.join(os.path.dirname(__file__), "..", "chiketi", "assets", "probe", "chiketi-probe")
SMART = os.path.join(os.path.dirname(__file__), "..", "chiketi", "assets", "probe", "smart-read")

pytestmark = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="probe is Linux-only")


def run_probe() -> dict[str, list[str]]:
    out = subprocess.run(["sh", PROBE], capture_output=True, text=True, timeout=60, check=True).stdout
    keys: dict[str, list[str]] = {}
    for line in out.splitlines():
        k, _, v = line.partition("=")
        keys.setdefault(k, []).append(v)
    return keys


def test_probe_prints_required_keys():
    keys = run_probe()
    assert keys["probe_version"] == ["2"]
    assert keys["kind"][0] in ("linux", "unraid")
    assert int(keys["mem_total_kb"][0]) > 0
    assert int(keys["mem_avail_kb"][0]) >= 0
    assert any(v.startswith("/|") for v in keys.get("fs", [])), keys.get("fs")


def test_probe_never_wakes_disks():
    with open(SMART) as f:
        src = f.read()
    assert "-n standby" in src
    assert "exec smartctl" in src


def test_smart_read_rejects_bad_device_names():
    for bad in ["", "../sda", "sda;id", "sda b", "/dev/sda"]:
        r = subprocess.run(["sh", SMART, bad], capture_output=True, text=True, check=False)
        assert r.returncode == 2, bad


@pytest.mark.skipif(shutil.which("shellcheck") is None, reason="shellcheck not installed")
def test_shellcheck_clean():
    subprocess.run(["shellcheck", "-s", "sh", PROBE, SMART], check=True)



NEEDED = ["sh", "awk", "cat", "df", "grep", "id", "lsblk", "printf", "sed", "tr", "cut", "find",
          "mv", "systemctl", "apt-get", "sort", "uniq", "head", "sleep", "date"]


def _controlled_probe(tmp_path, fake_nvsmi: str | None, with_timeout: bool = True):
    """A copy of the probe whose PATH is: fakes, then symlinks to only the tools it needs."""
    fakes = tmp_path / "fakes"
    tools = tmp_path / "tools"
    fakes.mkdir()
    tools.mkdir()
    for name in NEEDED + (["timeout"] if with_timeout else []):
        real = shutil.which(name)
        if real:
            os.symlink(real, tools / name)
    if fake_nvsmi is not None:
        f = fakes / "nvidia-smi"
        f.write_text("#!/bin/sh\n" + textwrap.dedent(fake_nvsmi))
        f.chmod(f.stat().st_mode | stat.S_IEXEC)
    with open(PROBE) as fh:
        src = fh.read()
    line = "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    assert line in src                      # the production PATH line is unchanged
    copy = tmp_path / "probe"
    copy.write_text(src.replace(line, f"PATH={fakes}:{tools}", 1))
    shell = shutil.which("dash") or shutil.which("sh")
    out = subprocess.run([shell, str(copy)], capture_output=True, text=True, timeout=60, check=True,
                         env={"HOME": str(tmp_path), "ARGLOG": str(tmp_path / "args")}).stdout
    keys: dict[str, list[str]] = {}
    for ln in out.splitlines():
        k, _, v = ln.partition("=")
        keys.setdefault(k, []).append(v)
    return keys, out


ROW0 = "0, Tesla V100-PCIE-32GB, 35, 1200, 32768, 61, 120.50, 250.00, [N/A], 0x0000000000000004, 00000000:01:00.0"
ROW1 = "1, Tesla V100-PCIE-32GB, 0, 0, 32768, [N/A], 25.10, 250.00, [N/A], 0x0000000000000000, 00000000:02:00.0"
NV_OK = (
    'echo "$*" >> "$ARGLOG"\n'
    'case "$*" in\n'
    f'  *--query-gpu=*) printf \'%s\\n\' "{ROW0}" "{ROW1}" ;;\n'
    '  *--query-compute-apps=*) printf \'%s\\n\' "00000000:01:00.0" "00000000:01:00.0" ;;\n'
    'esac\n'
)


def test_gpu_lines_and_compat_temps(tmp_path):
    keys, out = _controlled_probe(tmp_path, NV_OK)
    assert keys["probe_version"] == ["2"]
    assert keys["gpu_query"] == ["ok|2"]
    assert keys["gpu"][0] == ("0|Tesla V100-PCIE-32GB|35|1200|32768|61|120.50|250.00||"
                              "0x0000000000000004|00000000:01:00.0")
    assert keys["gpu"][1].split("|")[5] == ""            # [N/A] temperature is empty
    assert keys["gpu_temp_c"] == ["61"]                    # from the same sample; none for the N/A one
    assert keys["gpu_procs_query"] == ["ok"]
    assert keys["gpu_procs"] == ["00000000:01:00.0|2"]
    args = (tmp_path / "args").read_text().splitlines()
    assert len(args) == 2 and "clocks_throttle_reasons.active" in args[0]
    assert "--query-compute-apps=gpu_bus_id" in args[1]
    assert "python" not in out and "pid" not in out.lower()


def test_invalid_field_retries_with_new_name(tmp_path):
    nv = '''
    echo "$*" >> "$ARGLOG"
    case "$*" in
      *clocks_throttle_reasons*) echo 'Field "clocks_throttle_reasons.active" is not a valid field to query.'; exit 2 ;;
      *--query-gpu=*) echo "0, X, 1, 2, 3, 40, 5, 6, 7, 0x0, 00000000:01:00.0" ;;
    esac
    '''
    keys, _ = _controlled_probe(tmp_path, nv)
    assert keys["gpu_query"] == ["ok|1"]
    assert "clocks_event_reasons.active" in (tmp_path / "args").read_text().splitlines()[1]


def test_other_failure_does_not_retry(tmp_path):
    nv = '''
    echo "$*" >> "$ARGLOG"
    echo "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver."; exit 9
    '''
    keys, _ = _controlled_probe(tmp_path, nv)
    assert keys["gpu_query"] == ["fail|9"] and "gpu" not in keys and "gpu_procs_query" not in keys
    assert len((tmp_path / "args").read_text().splitlines()) == 1


def test_hung_query_is_cut_off(tmp_path):
    import time
    if not shutil.which("timeout"):
        pytest.skip("no timeout(1)")
    t0 = time.monotonic()
    keys, _ = _controlled_probe(tmp_path, 'echo started >> "$ARGLOG"; sleep 30\n')
    assert time.monotonic() - t0 < 20
    assert keys["gpu_query"] == ["fail|124"]
    assert "started" in (tmp_path / "args").read_text()


def test_without_timeout_still_runs(tmp_path):
    keys, _ = _controlled_probe(tmp_path, NV_OK, with_timeout=False)
    assert keys["gpu_query"] == ["ok|2"]


def test_failing_process_query(tmp_path):
    nv = '''
    case "$*" in
      *--query-gpu=*) echo "0, X, 1, 2, 3, 40, 5, 6, 7, 0x0, 00000000:01:00.0" ;;
      *) exit 4 ;;
    esac
    '''
    keys, _ = _controlled_probe(tmp_path, nv)
    assert keys["gpu_procs_query"] == ["fail|4"] and "gpu_procs" not in keys


def test_malformed_line_is_counted_not_printed(tmp_path):
    nv = '''
    case "$*" in
      *--query-gpu=*) printf '%s\\n' "0, X, 1, 2, 3, 40, 5, 6, 7, 0x0, 00000000:01:00.0" "garbage" ;;
    esac
    '''
    keys, _ = _controlled_probe(tmp_path, nv)
    assert keys["gpu_query"] == ["ok|2"] and len(keys["gpu"]) == 1


def test_hostile_name_is_stripped(tmp_path):
    name = "Evil|name=<img src=x>" + "A" * 44
    nv = f'''
    case "$*" in
      *--query-gpu=*) echo "0, {name}, 1, 2, 3, 40, 5, 6, 7, 0x0, 00:01|=x" ;;
    esac
    '''
    keys, _ = _controlled_probe(tmp_path, nv)
    f = keys["gpu"][0].split("|")
    assert len(f) == 11 and "=" not in f[1] and len(f[1]) <= 40 and f[10] == "00:01x"


def test_no_nvidia_smi(tmp_path):
    keys, _ = _controlled_probe(tmp_path, None)
    assert keys["gpu_tool"] == ["absent"] and "gpu_query" not in keys


def test_query_ignoring_term_is_killed(tmp_path):
    import time
    if not shutil.which("timeout"):
        pytest.skip("no timeout(1)")
    t0 = time.monotonic()
    keys, _ = _controlled_probe(tmp_path, 'trap "" TERM\necho started >> "$ARGLOG"\nexec sleep 30\n')
    assert time.monotonic() - t0 < 20
    assert keys["gpu_query"][0] in ("fail|124", "fail|137")
