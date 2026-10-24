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


def _controlled_probe(tmp_path, fake_nvsmi: str | None, with_timeout: bool = True, omit=(),
                      uptime: str | None = None, env: dict | None = None):
    """A copy of the probe whose PATH is: fakes, then symlinks to only the tools it needs.
    omit: tools left out (so slow, host-dependent parts are skipped). uptime: the contents
    of the uptime file the probe reads (CHIKETI_PROBE_UPTIME); env: extra variables."""
    fakes = tmp_path / "fakes"
    tools = tmp_path / "tools"
    fakes.mkdir()
    tools.mkdir()
    for name in NEEDED + (["timeout"] if with_timeout else []):
        if name in omit:
            continue
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
    e = {"HOME": str(tmp_path), "ARGLOG": str(tmp_path / "args"), **(env or {})}
    if uptime is not None:
        (tmp_path / "uptime").write_text(uptime)
    e["CHIKETI_PROBE_UPTIME"] = str(tmp_path / "uptime")   # absent file unless given
    out = subprocess.run([shell, str(copy)], capture_output=True, text=True, timeout=60, check=True,
                         env=e).stdout
    keys: dict[str, list[str]] = {}
    for ln in out.splitlines():
        k, _, v = ln.partition("=")
        keys.setdefault(k, []).append(v)
    return keys, out


ROW0 = ("0, Tesla V100-PCIE-32GB, 35, 1200, 32768, 61, 120.50, 250.00, [N/A], 0x0000000000000004, "
        "00000000:01:00.0, GPU-0a1b2c3d-0000-1111-2222-333344445555")
ROW1 = ("1, Tesla V100-PCIE-32GB, 0, 0, 32768, [N/A], 25.10, 250.00, [N/A], 0x0000000000000000, "
        "00000000:02:00.0, [N/A]")
SHORT = "0, X, 1, 2, 3, 40, 5, 6, 7, 0x0, 00000000:01:00.0, GPU-1"
NV_OK = (
    'echo "$*" >> "$ARGLOG"\n'
    'case "$*" in\n'
    '  *temperature.memory*) printf \'%s\\n\' "00000000:01:00.0, 84" "00000000:02:00.0, [N/A]" ;;\n'
    f'  *--query-gpu=*) printf \'%s\\n\' "{ROW0}" "{ROW1}" ;;\n'
    '  *--query-compute-apps=*) printf \'%s\\n\' "00000000:01:00.0" "00000000:01:00.0" ;;\n'
    'esac\n'
)


def test_gpu_lines_and_compat_temps(tmp_path):
    keys, out = _controlled_probe(tmp_path, NV_OK)
    assert keys["probe_version"] == ["2"]
    assert keys["gpu_query"] == ["ok|2"]
    assert keys["gpu"][0] == ("0|Tesla V100-PCIE-32GB|35|1200|32768|61|120.50|250.00||"
                              "0x0000000000000004|00000000:01:00.0|GPU-0a1b2c3d-0000-1111-2222-333344445555")
    assert keys["gpu"][1].split("|")[11] == ""            # [N/A] UUID is empty
    assert keys["gpu"][1].split("|")[5] == ""            # [N/A] temperature is empty
    assert keys["gpu_temp_c"] == ["61"]                    # from the same sample; none for the N/A one
    assert keys["gpu_procs_query"] == ["ok"]
    assert keys["gpu_procs"] == ["00000000:01:00.0|2"]
    args = (tmp_path / "args").read_text().splitlines()
    assert "clocks_throttle_reasons.active" in args[0]
    assert "pci.bus_id,uuid" in args[0]
    assert "--query-compute-apps=gpu_bus_id" in args[1]
    assert len(args) == 2                                  # no uptime file: no memory query
    assert "python" not in out and "pid" not in out.lower()


def test_invalid_field_retries_with_new_name(tmp_path):
    nv = '''
    echo "$*" >> "$ARGLOG"
    case "$*" in
      *clocks_throttle_reasons*) echo 'Field "clocks_throttle_reasons.active" is not a valid field to query.'; exit 2 ;;
      *--query-gpu=*) echo "0, X, 1, 2, 3, 40, 5, 6, 7, 0x0, 00000000:01:00.0, GPU-1" ;;
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
      *--query-gpu=*) echo "0, X, 1, 2, 3, 40, 5, 6, 7, 0x0, 00000000:01:00.0, GPU-1" ;;
      *) exit 4 ;;
    esac
    '''
    keys, _ = _controlled_probe(tmp_path, nv)
    assert keys["gpu_procs_query"] == ["fail|4"] and "gpu_procs" not in keys


def test_malformed_line_is_counted_not_printed(tmp_path):
    nv = '''
    case "$*" in
      *--query-gpu=*) printf '%s\\n' "0, X, 1, 2, 3, 40, 5, 6, 7, 0x0, 00000000:01:00.0, GPU-1" "garbage" ;;
    esac
    '''
    keys, _ = _controlled_probe(tmp_path, nv)
    assert keys["gpu_query"] == ["ok|2"] and len(keys["gpu"]) == 1


def test_hostile_name_is_stripped(tmp_path):
    name = "Evil|name=<img src=x>" + "A" * 44
    nv = f'''
    case "$*" in
      *--query-gpu=*) echo "0, {name}, 1, 2, 3, 40, 5, 6, 7, 0x0, 00:01|=x, GPU-a|=b" ;;
    esac
    '''
    keys, _ = _controlled_probe(tmp_path, nv)
    f = keys["gpu"][0].split("|")
    assert len(f) == 12 and "=" not in f[1] and len(f[1]) <= 40 and f[10] == "00:01x" and f[11] == "GPU-ab"


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


# --- memory temperature and UUID (spec §6.4) ---

QUIET = ("systemctl", "apt-get", "lsblk")    # nothing slow or host-dependent


def _nv_mem(mem_case: str) -> str:
    """A fake whose main query moves the uptime clock to $UPNEXT (if set), so the probe's
    start read and its gate read differ."""
    return (
        'echo "$*" >> "$ARGLOG"\n'
        'case "$*" in\n'
        f'  *temperature.memory*) {mem_case} ;;\n'
        '  *--query-gpu=*) [ -n "$UPNEXT" ] && echo "$UPNEXT" > "$CHIKETI_PROBE_UPTIME"\n'
        f'    printf \'%s\\n\' "{ROW0}" "{ROW1}" ;;\n'
        '  *--query-compute-apps=*) echo "00000000:01:00.0" ;;\n'
        'esac\n')


MEM_OK = _nv_mem('printf \'%s\\n\' "00000000:01:00.0, 84" "00000000:02:00.0, [N/A]"')


def _mem_ran(tmp_path) -> bool:
    return "temperature.memory" in (tmp_path / "args").read_text()


def test_mem_temp_lines_last(tmp_path):
    keys, out = _controlled_probe(tmp_path, MEM_OK, omit=QUIET, uptime="100.25 5\n")
    assert keys["gpu_mem_temp"] == ["00000000:01:00.0|84"]
    assert out.splitlines()[-1] == "gpu_mem_temp=00000000:01:00.0|84"
    assert keys["gpu_procs"] == ["00000000:01:00.0|1"]


def test_mem_query_failure_keeps_sample(tmp_path):
    keys, _ = _controlled_probe(tmp_path, _nv_mem("exit 6"), omit=QUIET, uptime="100 5\n")
    assert _mem_ran(tmp_path)
    assert len(keys["gpu"]) == 2 and keys["gpu_procs"] == ["00000000:01:00.0|1"]
    assert "gpu_mem_temp" not in keys


def test_no_timeout_no_mem_query(tmp_path):
    keys, _ = _controlled_probe(tmp_path, MEM_OK, with_timeout=False, omit=QUIET, uptime="100 5\n")
    assert len(keys["gpu"]) == 2 and not _mem_ran(tmp_path)


@pytest.mark.parametrize("start, later, runs", [
    ("100.9 1", "119.2 1", True),     # 19 s elapsed
    ("100 1", "120 1", False),        # 20 s
    ("100 1", "90 1", False),         # backwards
    ("abc", None, False),             # not a number
])
def test_mem_gate(tmp_path, start, later, runs):
    env = {"UPNEXT": later} if later else {}
    keys, _ = _controlled_probe(tmp_path, MEM_OK, omit=QUIET, uptime=start + "\n", env=env)
    assert _mem_ran(tmp_path) is runs
    assert ("gpu_mem_temp" in keys) is runs and len(keys["gpu"]) == 2


def test_mem_gate_missing_uptime(tmp_path):
    keys, _ = _controlled_probe(tmp_path, MEM_OK, omit=QUIET)
    assert not _mem_ran(tmp_path) and len(keys["gpu"]) == 2


def test_mem_gate_extra_lines_ignored(tmp_path):
    keys, out = _controlled_probe(tmp_path, MEM_OK, omit=QUIET, uptime="100.0 0\n101.0 0\n")
    assert _mem_ran(tmp_path) and keys["gpu_mem_temp"] == ["00000000:01:00.0|84"]


def test_mem_gate_skipped_after_failed_main_query(tmp_path):
    nv = 'echo "$*" >> "$ARGLOG"\nexit 9\n'
    keys, _ = _controlled_probe(tmp_path, nv, omit=QUIET, uptime="100 5\n")
    assert keys["gpu_query"] == ["fail|9"] and not _mem_ran(tmp_path)


@pytest.mark.parametrize("hang", ["sleep 30", 'trap "" TERM; sleep 30'])
def test_mem_query_hang_cut_off(tmp_path, hang):
    import time
    if not shutil.which("timeout"):
        pytest.skip("no timeout(1)")
    t0 = time.monotonic()
    keys, _ = _controlled_probe(tmp_path, _nv_mem(hang), omit=QUIET, uptime="100 5\n")
    assert time.monotonic() - t0 < 8
    assert _mem_ran(tmp_path) and len(keys["gpu"]) == 2 and "gpu_mem_temp" not in keys
