# GPUs Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Kiosk "GPUs" screen showing every NVIDIA GPU on the Home Lab hosts, worst first, with honest states for missing or old data.

**Architecture:**
- The read-only probe (v2) prints a GPU query outcome, one line per GPU, and a per-bus process count.
- The Home Lab parser builds `Gpu` records.
- The rules give each GPU a state and one alert condition.
- The poller keeps each host's outcome and its last GPUs. The GPUs are remembered in the baseline file across restarts.
- The collector publishes `homelab.gpus` and `homelab.gpu_hosts`.
- A new fluid Bridge Station screen, `bsGpusScreen`, renders full and strip layouts in TOS and Claude, and the tab's attention colour follows the same rules.

**Tech Stack:** POSIX sh (dash, Unraid), Python 3.11+ (pytest), browser JS evaluated by the Node harness, Playwright checks.

**Spec:** `specs/2026-10-24-gpus-screen-design.md`

## Global Constraints

- The probe stays read-only, takes no arguments, keeps its fixed `PATH`, and uses no bash-isms (no arrays, `pipefail`, `local` or process substitution). It never prints process names or PIDs.
- Probe time limits: where `timeout` exists, 5 s for the detailed query, 5 s for its one retry, and 4 s for the process query. `run_probe` timeout goes from 20 s to 30 s.
- Throttle bits are `0x08 | 0x20 | 0x40 | 0x80`. `0x04` is not throttling.
- State order: CRITICAL, HOT, THROTTLING, UNREADABLE, OFFLINE, NO DETAIL, UNKNOWN, BUSY, IDLE.
- BUSY means util ≥ 10 or procs ≥ 1. IDLE means util known and < 10 **and** procs == 0. Anything else is UNKNOWN.
- `stale_after = 2 × (1.1 × poll_seconds + ceil(hosts / 8) × 40)`. `published_at` is stamped by the poller.
- Power text: `W NOW` iff fresh and `a = n > 0`; `W FROM a OF n GPUS` iff `0 < a < n`; else `-- W`.
- Kiosk defaults become `["lab", "sessions", "gpus"]`. Saved displays are untouched.
- Harness rules apply (no layout px > 2, `esc()` everywhere, FULL defines every `m()` key). Public repo: neutral names only (`gpubox`, `devbox`, `192.0.2.x`).
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01BmBXX8FiZQeTmh7ahaTUZ1`.

## Review Focus

1. A version-1 probe on the GPU host (before redeploy) must show NO DETAIL rows with temperatures, not an empty screen. Covered by Task 3 `test_legacy_rows_before_redeploy`.
2. A raised GPU heat alert must not clear on `N/A` readings or a failed GPU query. Covered by Task 2 and Task 3 tests.
3. A restart while the GPU host is down must show its remembered GPUs as OFFLINE with their age. Covered by Task 3 `test_restart_during_outage`.
4. On the 1920×462 strip, with 2 GPUs and 7 tabs, nothing overflows. Covered by Task 7 `fit_check`.
5. A hostile GPU name or host name never becomes markup. Covered by Task 5 `GPU_HOUSE_HOSTILE` in the leak check.

---

### Task 1: Probe v2 (`assets/probe/chiketi-probe`)

**Files:**
- Modify: `chiketi/assets/probe/chiketi-probe` (version line; replace the `nvidia-smi` block)
- Test: `tests/test_homelab_probe_script.py`

**Interfaces:**
- Produces these output lines:
  - `probe_version=2`
  - `gpu_tool=absent`
  - `gpu_query=ok|<n>` or `gpu_query=fail|<rc>`
  - `gpu=<11 fields>`
  - `gpu_temp_c=<t>`
  - `gpu_procs_query=ok` or `gpu_procs_query=fail|<rc>`
  - `gpu_procs=<bus>|<count>`

- [ ] **Step 1: Write the failing tests** (append to `tests/test_homelab_probe_script.py`; change the existing `== ["1"]` to `== ["2"]`)

```python
import stat
import textwrap

NEEDED = ["sh", "awk", "cat", "df", "grep", "id", "lsblk", "printf", "sed", "tr", "cut", "find",
          "mv", "systemctl", "apt-get", "command", "sort", "uniq", "head"]


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
    out = subprocess.run([shell, str(copy)], capture_output=True, text=True, timeout=60,
                         env={"HOME": str(tmp_path), "ARGLOG": str(tmp_path / "args")}).stdout
    keys: dict[str, list[str]] = {}
    for ln in out.splitlines():
        k, _, v = ln.partition("=")
        keys.setdefault(k, []).append(v)
    return keys, out


NV_OK = '''
echo "$*" >> "$ARGLOG"
case "$*" in
  *--query-gpu=*) printf '%s\\n' "0, Tesla V100-PCIE-32GB, 35, 1200, 32768, 61, 120.50, 250.00, [N/A], 0x0000000000000004, 00000000:01:00.0" \\
                         "1, Tesla V100-PCIE-32GB, 0, 0, 32768, [N/A], 25.10, 250.00, [N/A], 0x0000000000000000, 00000000:02:00.0" ;;
  *--query-compute-apps=*) printf '%s\\n' "00000000:01:00.0" "00000000:01:00.0" ;;
esac
'''


def test_gpu_lines_and_compat_temps(tmp_path):
    keys, out = _controlled_probe(tmp_path, NV_OK)
    assert keys["probe_version"] == ["2"]
    assert keys["gpu_query"] == ["ok|2"]
    assert keys["gpu"][0] == "0|Tesla V100-PCIE-32GB|35|1200|32768|61|120.50|250.00||0x0000000000000004|00000000:01:00.0"
    assert keys["gpu"][1].split("|")[5] == ""            # [N/A] temperature is empty
    assert keys["gpu_temp_c"] == ["61"]                    # from the same sample; none for the N/A one
    assert keys["gpu_procs_query"] == ["ok"]
    assert keys["gpu_procs"] == ["00000000:01:00.0|2"]
    args = (tmp_path / "args").read_text().splitlines()
    assert len(args) == 2 and "clocks_throttle_reasons.active" in args[0] and "--query-compute-apps=gpu_bus_id" in args[1]
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
    if not shutil.which("timeout"):
        pytest.skip("no timeout(1)")
    keys, _ = _controlled_probe(tmp_path, "sleep 30\n")
    assert keys["gpu_query"][0].startswith("fail|")


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
    nv = '''
    case "$*" in
      *--query-gpu=*) echo "0, Evil|name=<img src=x>AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA, 1, 2, 3, 40, 5, 6, 7, 0x0, 00:01|=x" ;;
    esac
    '''
    keys, _ = _controlled_probe(tmp_path, nv)
    f = keys["gpu"][0].split("|")
    assert len(f) == 11 and "=" not in f[1] and len(f[1]) <= 40 and f[10] == "00:01x"


def test_no_nvidia_smi(tmp_path):
    keys, _ = _controlled_probe(tmp_path, None)
    assert keys["gpu_tool"] == ["absent"] and "gpu_query" not in keys
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/bin/python -m pytest tests/test_homelab_probe_script.py -q`
Expected: failures on `probe_version` and `gpu_query`.

- [ ] **Step 3: Implement**

Change `echo "probe_version=1"` to `echo "probe_version=2"`. Replace the whole `if command -v nvidia-smi … fi` block with:

```sh
# GPUs (NVIDIA): one sample, its outcome, and a process COUNT per card. No names,
# no PIDs. Each call is time-boxed where timeout(1) exists.
nv() {
  nv_s=$1; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$nv_s" nvidia-smi "$@"; else nvidia-smi "$@"; fi
}
if command -v nvidia-smi >/dev/null 2>&1; then
  F=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed
  out=$(nv 5 --query-gpu="$F,clocks_throttle_reasons.active,pci.bus_id" --format=csv,noheader,nounits 2>/dev/null)
  rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qi 'valid field'; then
    out=$(nv 5 --query-gpu="$F,clocks_event_reasons.active,pci.bus_id" --format=csv,noheader,nounits 2>/dev/null)
    rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    echo "gpu_query=fail|$rc"
  else
    echo "gpu_query=ok|$(printf '%s\n' "$out" | grep -c .)"
    printf '%s\n' "$out" | awk -F', ' '
      function num(x) { gsub(/^ +| +$/, "", x); return (x ~ /^-?[0-9]+(\.[0-9]+)?$/) ? x : "" }
      NF {
        if (NF != 11) next
        idx = num($1); if (idx == "" || idx ~ /[.-]/) next
        name = $2; gsub(/[|=]/, "", name); name = substr(name, 1, 40)
        thr = $10; gsub(/ /, "", thr); if (thr !~ /^0x[0-9A-Fa-f]+$/) thr = ""
        bus = $11; gsub(/[|= ]/, "", bus)
        t = num($6)
        print "gpu=" idx "|" name "|" num($3) "|" num($4) "|" num($5) "|" t "|" num($7) "|" num($8) "|" num($9) "|" thr "|" bus
        if (t != "") print "gpu_temp_c=" int(t)
      }'
    pout=$(nv 4 --query-compute-apps=gpu_bus_id --format=csv,noheader 2>/dev/null)
    prc=$?
    if [ "$prc" -ne 0 ]; then
      echo "gpu_procs_query=fail|$prc"
    else
      echo "gpu_procs_query=ok"
      printf '%s\n' "$pout" | awk 'NF { b = $0; gsub(/[|= ]/, "", b); if (b != "") c[b]++ }
        END { for (b in c) print "gpu_procs=" b "|" c[b] }'
    fi
  fi
else
  echo "gpu_tool=absent"
fi
```

- [ ] **Step 4: Run the tests and shellcheck, and watch them pass**

Run: `.venv/bin/python -m pytest tests/test_homelab_probe_script.py -q && shellcheck -s sh chiketi/assets/probe/chiketi-probe`
Expected: all pass, and shellcheck is clean. If shellcheck flags SC2317 or similar, fix the code, not the check.

- [ ] **Step 5: Commit** `feat(probe): v2 -- GPU sample with outcome, process counts, time-boxed nvidia-smi`

---

### Task 2: Parser and rules (`probe.py`, `rules.py`)

**Files:**
- Modify: `chiketi/collectors/homelab/probe.py`, `chiketi/collectors/homelab/rules.py`
- Test: `tests/test_homelab_probe.py`, `tests/test_homelab_rules.py`

**Interfaces:**
- Produces:
  - `Gpu` (fields as in the spec, plus `detail: bool = True`);
  - `ProbeReport.gpus: list[Gpu]`, `gpu_tool: str | None`, `gpu_query: str | None` (`ok`/`fail`/`legacy`), `gpu_rows: int | None`, `gpu_procs_query: str | None`;
  - `MAX_GPUS = 16`;
  - in rules: `THROTTLE_BITS`, `throttling(g) -> bool`, `gpu_state(g, thr, outcome) -> str` (returns lowercase keys `critical|hot|throttling|unreadable|offline|nodetail|unknown|busy|idle`), `gpu_condition(g, thr) -> Condition | None`, `gpu_keep_keys(rep) -> set[str]`;
  - `IssueTracker.update(host, conds, now, partial=False, keep=None)`;
  - `Baseline.gpu_memory() -> dict[str, tuple[list[Gpu], float]]`, `Baseline.remember_gpus(host, gpus, seen_at)`, `Baseline.forget_gpus(host)`.

- [ ] **Step 1: Write the failing tests**

`tests/test_homelab_probe.py`:

```python
V2 = """probe_version=2
kind=linux
gpu_query=ok|2
gpu=0|Tesla V100|35|1200|32768|61|120.5|250||0x0000000000000004|00000000:01:00.0
gpu=1|Tesla V100|0|0|32768||25.1|250||0x0|00000000:02:00.0
gpu_temp_c=61
gpu_procs_query=ok
gpu_procs=00000000:01:00.0|2
"""


def test_v2_gpus():
    r = parse_probe(V2)
    assert r.gpu_query == "ok" and r.gpu_rows == 2 and len(r.gpus) == 2
    g0, g1 = r.gpus
    assert (g0.index, g0.name, g0.util, g0.vram_used, g0.vram_total, g0.temp, g0.power, g0.power_limit) == \
        (0, "Tesla V100", 35.0, 1200.0, 32768.0, 61.0, 120.5, 250.0)
    assert g0.fan is None and g0.throttle == 4 and g0.procs == 2 and g0.detail is True
    assert g1.temp is None and g1.procs == 0                       # query ok, no line -> 0


def test_v2_failed_procs_query_is_unknown():
    r = parse_probe(V2.replace("gpu_procs_query=ok", "gpu_procs_query=fail|4"))
    assert [g.procs for g in r.gpus] == [None, None]


def test_v1_gpus_are_legacy_temperature_rows():
    r = parse_probe("probe_version=1\ngpu_temp_c=70\ngpu_temp_c=40\n")
    assert r.gpu_query == "legacy"
    assert [(g.index, g.temp, g.detail) for g in r.gpus] == [(0, 70.0, False), (1, 40.0, False)]


@pytest.mark.parametrize("line", [
    "gpu=x|n|1|2|3|4|5|6|7|0x0|b",           # bad index
    "gpu=0|n|1|2|3|4|5|6|7|0x0",             # 10 fields
    "gpu=-1|n|1|2|3|4|5|6|7|0x0|b",          # negative
])
def test_bad_gpu_lines_dropped(line):
    r = parse_probe(f"probe_version=2\ngpu_query=ok|1\n{line}\n")
    assert r.gpus == [] and r.gpu_rows == 1


def test_nan_inf_and_hex():
    r = parse_probe("probe_version=2\ngpu_query=ok|1\ngpu=0|n|nan|inf|-inf|1e400|NaN|5|6|zz|b\n")
    g = r.gpus[0]
    assert (g.util, g.vram_used, g.vram_total, g.temp, g.power, g.throttle) == (None, None, None, None, None, None)


def test_gpu_cap_and_tool_absent():
    lines = "".join(f"gpu={i}|n|1|2|3|4|5|6|7|0x0|b{i}\n" for i in range(20))
    assert len(parse_probe(f"probe_version=2\ngpu_query=ok|20\n{lines}").gpus) == 16
    assert parse_probe("probe_version=2\ngpu_tool=absent\n").gpu_tool == "absent"
    assert parse_probe("probe_version=2\ngpu_query=fail|9\n").gpu_query == "fail"
```

`tests/test_homelab_rules.py`:

```python
from chiketi.collectors.homelab.probe import Gpu
from chiketi.collectors.homelab.rules import (IssueTracker, gpu_condition, gpu_keep_keys, gpu_state,
                                              throttling, DEFAULT_THRESHOLDS as _unused)  # noqa: F401
from chiketi.collectors.homelab.config import DEFAULT_THRESHOLDS

THR = dict(DEFAULT_THRESHOLDS)   # gpu_warn_c 85, gpu_crit_c 92


def G(**kw):
    base = dict(index=0, name="V100", util=None, vram_used=None, vram_total=None, temp=50.0,
                power=None, power_limit=None, fan=None, throttle=0, bus_id="b", procs=None, detail=True)
    base.update(kw)
    return Gpu(**base)


@pytest.mark.parametrize("util,procs,want", [
    (None, None, "unknown"), (None, 0, "unknown"), (None, 1, "busy"),
    (0, None, "unknown"), (0, 0, "idle"), (0, 1, "busy"),
    (9, None, "unknown"), (9, 0, "idle"), (9, 1, "busy"),
    (10, None, "busy"), (10, 0, "busy"), (10, 1, "busy"),
])
def test_activity_cross_product(util, procs, want):
    assert gpu_state(G(util=util, procs=procs), THR, "ok") == want


def test_state_precedence_and_boundaries():
    assert gpu_state(G(temp=99.0), THR, "offline") == "offline"
    assert gpu_state(G(temp=99.0), THR, "unreadable") == "unreadable"
    assert gpu_state(G(temp=92.0), THR, "ok") == "critical"
    assert gpu_state(G(temp=91.9), THR, "ok") == "hot"
    assert gpu_state(G(temp=85.0), THR, "ok") == "hot"
    assert gpu_state(G(temp=84.9, throttle=0x20, util=50), THR, "ok") == "throttling"
    assert gpu_state(G(throttle=0x04, util=50), THR, "ok") == "busy"           # SW power cap is normal
    assert gpu_state(G(detail=False, temp=40.0), THR, "legacy") == "nodetail"
    for bit in (0x08, 0x20, 0x40, 0x80):
        assert throttling(G(throttle=bit))
    assert not throttling(G(throttle=None))


def test_one_condition_per_gpu():
    assert gpu_condition(G(temp=95.0), THR).severity == "crit"
    c = gpu_condition(G(temp=60.0, throttle=0x40), THR)
    assert (c.key, c.severity, c.title) == ("gpu_temp:0", "warn", "GPU 0 throttling")
    assert gpu_condition(G(temp=60.0), THR) is None


def test_throttle_to_crit_never_drops_the_alert():
    t = IssueTracker()
    for i in range(4):
        t.update("gpubox", [gpu_condition(G(temp=60.0, throttle=0x20), THR)], i)
    assert t.issues()[0]["title"] == "GPU 0 throttling"
    for i in range(4, 7):                       # turns into heat: same key, raised throughout
        t.update("gpubox", [gpu_condition(G(temp=95.0, throttle=0x20), THR)], i)
        assert t.issues() and t.issues()[0]["severity"] == "crit"
    t.update("gpubox", [gpu_condition(G(temp=60.0, throttle=0x20), THR)], 7)
    assert t.issues()[0]["title"] == "GPU 0 throttling"


def test_keep_preserves_named_keys_only():
    t = IssueTracker()
    for i in range(4):
        t.update("gpubox", [gpu_condition(G(temp=95.0), THR), Condition("mem", "warn", "m", "", 1)], i)
    keep = lambda k: k.startswith("gpu_temp:")   # noqa: E731
    for i in range(4, 8):
        t.update("gpubox", [], i, keep=keep)
    titles = [x["title"] for x in t.issues()]
    assert titles == ["GPU 0 95°C"]             # the GPU alert stays, memory cleared


def test_keep_keys_for_missing_fields():
    from chiketi.collectors.homelab.probe import ProbeReport
    rep = ProbeReport(version=2, gpus=[G(index=0, temp=None), G(index=1, throttle=None), G(index=2)])
    assert gpu_keep_keys(rep) == {"gpu_temp:0", "gpu_temp:1"}
    legacy = ProbeReport(version=1, gpus=[G(index=0, temp=None, throttle=None, detail=False)])
    assert gpu_keep_keys(legacy) == {"gpu_temp:0"}


def test_baseline_remembers_gpus(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    b.remember_gpus("gpubox", [G(index=1, temp=70.0)], 123.0)
    b.save()
    again = Baseline(str(tmp_path / "b.json")).gpu_memory()
    (gpus, seen) = again["gpubox"]
    assert seen == 123.0 and gpus[0].index == 1 and gpus[0].temp == 70.0
    b.forget_gpus("gpubox")
    b.save()
    assert Baseline(str(tmp_path / "b.json")).gpu_memory() == {}


def test_baseline_ignores_bad_gpu_memory(tmp_path):
    p = tmp_path / "b.json"
    p.write_text('{"smart": {}, "sec": {}, "gpus": {"x": {"seen_at": "no", "gpus": [{"index": "a"}]}, "y": 5}}')
    assert Baseline(str(p)).gpu_memory() == {}
```

(Drop the bogus `DEFAULT_THRESHOLDS as _unused` line from the import, and import `Condition` and `Baseline` from rules, which the file already does at the top.) Update `test_gpu_temps_repeat` and `test_temperatures` if they relied on `gpu_temps` driving conditions: a version-1 report with `gpu_temp_c` lines still yields `gpu_temp:<i>` conditions through `rep.gpus`.

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/bin/python -m pytest tests/test_homelab_probe.py tests/test_homelab_rules.py -q`
Expected: ImportError on `Gpu` and `gpu_state`.

- [ ] **Step 3: Implement `probe.py`**

```python
MAX_GPUS = 16


@dataclass
class Gpu:
    index: int
    name: str = ""
    util: float | None = None
    vram_used: float | None = None
    vram_total: float | None = None
    temp: float | None = None
    power: float | None = None
    power_limit: float | None = None
    fan: float | None = None
    throttle: int | None = None
    bus_id: str = ""
    procs: int | None = None
    detail: bool = True
```

`ProbeReport` gains:

```python
    gpus: list[Gpu] = field(default_factory=list)
    gpu_tool: str | None = None
    gpu_query: str | None = None
    gpu_rows: int | None = None
    gpu_procs_query: str | None = None
```

`_float` becomes finite-only:

```python
def _float(s: str) -> float | None:
    try:
        v = float(s.strip())
    except ValueError:
        return None
    return v if math.isfinite(v) else None
```

Add `import math`. Add `_hex`:

```python
def _hex(s: str) -> int | None:
    s = s.strip()
    if not s.lower().startswith("0x"):
        return None
    try:
        return int(s, 16)
    except ValueError:
        return None
```

In `parse_probe`, add these branches, with a local `procs: dict[str, int] = {}` initialised before the loop:

```python
        elif k == "gpu_tool":
            r.gpu_tool = v.strip()
        elif k == "gpu_query":
            q, _, n = v.partition("|")
            r.gpu_query = q.strip()
            if r.gpu_query == "ok":
                r.gpu_rows = _int(n)
        elif k == "gpu_procs_query":
            r.gpu_procs_query = v.partition("|")[0].strip()
        elif k == "gpu_procs":
            bus, _, n = v.partition("|")
            c = _int(n)
            if bus and c is not None:
                procs[bus.strip().lower()] = c
        elif k == "gpu":
            f = v.split("|")
            idx = _int(f[0]) if len(f) == 11 else None
            if idx is None or idx < 0 or len(r.gpus) >= MAX_GPUS or any(g.index == idx for g in r.gpus):
                continue
            r.gpus.append(Gpu(index=idx, name=f[1].strip()[:40], util=_float(f[2]) if f[2] else None,
                              vram_used=_float(f[3]) if f[3] else None, vram_total=_float(f[4]) if f[4] else None,
                              temp=_float(f[5]) if f[5] else None, power=_float(f[6]) if f[6] else None,
                              power_limit=_float(f[7]) if f[7] else None, fan=_float(f[8]) if f[8] else None,
                              throttle=_hex(f[9]), bus_id=f[10].strip()[:32]))
```

After the loop:

```python
    if r.version >= 2:
        for g in r.gpus:
            g.procs = procs.get(g.bus_id.lower(), 0) if r.gpu_procs_query == "ok" else None
    else:
        r.gpu_query = "legacy"
        r.gpus = [Gpu(index=i, temp=t, detail=False) for i, t in enumerate(r.gpu_temps[:MAX_GPUS])]
    return r
```

- [ ] **Step 4: Implement `rules.py`**

```python
THROTTLE_BITS = 0x08 | 0x20 | 0x40 | 0x80   # HW slowdown, SW thermal, HW thermal, HW power brake


def throttling(g: Gpu) -> bool:
    return g.throttle is not None and bool(g.throttle & THROTTLE_BITS)


def gpu_state(g: Gpu, thr: dict, outcome: str) -> str:
    """The one-word state of a GPU (spec decision 3), first match wins."""
    if outcome in ("offline", "unreadable"):
        return outcome
    if g.temp is not None and g.temp >= thr["gpu_crit_c"]:
        return "critical"
    if g.temp is not None and g.temp >= thr["gpu_warn_c"]:
        return "hot"
    if throttling(g):
        return "throttling"
    if not g.detail:
        return "nodetail"
    if (g.util is not None and g.util >= 10) or (g.procs is not None and g.procs >= 1):
        return "busy"
    if g.util is not None and g.procs == 0:
        return "idle"
    return "unknown"


def gpu_condition(g: Gpu, thr: dict) -> Condition | None:
    """One condition per GPU, from heat or throttling, so a change between them keeps it raised."""
    key = f"gpu_temp:{g.index}"
    if g.temp is not None:
        sev = _level(g.temp, thr["gpu_warn_c"], thr["gpu_crit_c"])
        if sev:
            return Condition(key, sev, f"GPU {g.index} {g.temp:.0f}°C", "", HOLD_TEMP)
    if throttling(g):
        return Condition(key, "warn", f"GPU {g.index} throttling", "clock slowdown reported by the driver", HOLD_TEMP)
    return None


def gpu_keep_keys(rep: ProbeReport) -> set[str]:
    """GPUs whose reading cannot show an alert is over: a missing temperature, or (v2) mask."""
    return {f"gpu_temp:{g.index}" for g in rep.gpus
            if g.temp is None or (g.detail and g.throttle is None)}
```

Import `Gpu` from probe. In `evaluate_report`, replace the `rep.gpu_temps` loop with:

```python
    for g in rep.gpus:
        c = gpu_condition(g, thr)
        if c:
            out.append(c)
```

`IssueTracker.update` gains `keep=None`; in the clearing loop add `if keep is not None and keep(k[1]): continue` as the first line inside the `for k in …` loop.

`Baseline`:
- In `__init__`, after loading, keep a valid `gpus` dict: `self._data.setdefault("gpus", {})`, and if it is not a dict, replace it with `{}`.
- Add the methods below (`asdict` from `dataclasses`):

```python
    def gpu_memory(self) -> dict[str, tuple[list[Gpu], float]]:
        out = {}
        with self._lock:
            for host, rec in self._data.get("gpus", {}).items():
                try:
                    seen = float(rec["seen_at"])
                    gpus = [Gpu(**{k: v for k, v in g.items() if k in Gpu.__dataclass_fields__})
                            for g in rec["gpus"]]
                    if not all(isinstance(g.index, int) and not isinstance(g.index, bool) for g in gpus):
                        continue
                except (KeyError, TypeError, ValueError):
                    continue
                out[host] = (gpus, seen)
        return out

    def remember_gpus(self, host: str, gpus: list[Gpu], seen_at: float) -> None:
        with self._lock:
            self._data.setdefault("gpus", {})[host] = {"seen_at": seen_at, "gpus": [asdict(g) for g in gpus]}
            self._dirty = True

    def forget_gpus(self, host: str) -> None:
        with self._lock:
            if self._data.get("gpus", {}).pop(host, None) is not None:
                self._dirty = True
```

(`remember_gpus` on every successful poll rewrites the baseline file once per poll. That is acceptable: it is a small atomic write of a few hundred bytes.)

- [ ] **Step 5: Run the tests, and watch them pass along with all Home Lab tests**

Run: `.venv/bin/python -m pytest tests/test_homelab_probe.py tests/test_homelab_rules.py tests/test_homelab_collector.py -q`
Expected: pass.

- [ ] **Step 6: Commit** `feat(homelab): parse GPU samples; GPU states; one alert per GPU that clears only on evidence`

---

### Task 3: Poller and collector

**Files:**
- Modify: `chiketi/collectors/homelab/poller.py`, `chiketi/collectors/homelab/collector.py`, `chiketi/collectors/homelab/checks.py` (`timeout: float = 30.0`)
- Test: `tests/test_homelab_collector.py`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - snapshot keys `gpus` (list of row dicts), `gpu_hosts` (list of `{host, outcome}`), `published_at` (float or None), `host_count`;
  - metrics `homelab.gpus` (extra `warn_c`, `crit_c`, `published_at`, `stale_after`) and `homelab.gpu_hosts`;
  - `gpu_outcome(rep, has_known) -> str` in `poller.py`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_homelab_collector.py`)

```python
from chiketi.collectors.homelab.probe import Gpu

GPU_HOSTS = (Host("gpubox", "linux", address="g", user="u"), Host("devbox", "linux", address="w", user="u"))


def gmake(tmp_path, probe, hosts=GPU_HOSTS, poll=30):
    cfg = HomelabConfig(hosts=hosts, poll_seconds=poll)
    clock = iter(range(0, 100000, 30))
    return HomelabPoller(cfg, Baseline(str(tmp_path / "b.json")), clock=lambda: next(clock), probe=probe)


def v2(gpus, query="ok", rows=None, tool=None):
    r = ProbeReport(version=2, kind="linux", mem_total_kb=100, mem_avail_kb=80)
    r.gpus = gpus
    r.gpu_tool = tool
    r.gpu_query = query
    r.gpu_rows = len(gpus) if rows is None else rows
    r.gpu_procs_query = "ok"
    return r


def gpu(i, **kw):
    base = dict(index=i, name="V100", util=50.0, vram_used=1.0, vram_total=32768.0, temp=60.0,
                power=100.0, power_limit=250.0, fan=None, throttle=0, bus_id=f"b{i}", procs=1)
    base.update(kw)
    return Gpu(**base)


def test_gpu_rows_and_order(tmp_path):
    p = gmake(tmp_path, lambda h, c: v2([gpu(1), gpu(0)]) if h.name == "gpubox" else v2([], tool="absent", query=None))
    p.poll_once()
    s = p.snapshot()
    assert [(r["host"], r["index"], r["state"]) for r in s["gpus"]] == [("gpubox", 0, "busy"), ("gpubox", 1, "busy")]
    assert s["gpu_hosts"] == [{"host": "gpubox", "outcome": "ok"}, {"host": "devbox", "outcome": "none"}]
    assert s["published_at"] is not None


def test_offline_keeps_rows_with_age(tmp_path):
    state = {"down": False}

    def probe(h, c):
        if h.name == "gpubox" and state["down"]:
            raise CheckError("timed out")
        return v2([gpu(0)]) if h.name == "gpubox" else v2([], tool="absent", query=None)
    p = gmake(tmp_path, probe)
    p.poll_once()
    seen = p.snapshot()["gpus"][0]["seen_at"]
    state["down"] = True
    p.poll_once()
    row = p.snapshot()["gpus"][0]
    assert row["state"] == "offline" and row["seen_at"] == seen


def test_unreadable_and_rejected_lines(tmp_path):
    reps = iter([v2([gpu(0), gpu(1)]), v2([], query="fail"), v2([gpu(0)], rows=2)])
    p = gmake(tmp_path, lambda h, c: next(reps) if h.name == "gpubox" else v2([], tool="absent", query=None))
    p.poll_once()
    for _ in range(2):
        p.poll_once()
        s = p.snapshot()
        assert [r["state"] for r in s["gpus"]] == ["unreadable", "unreadable"]
        assert s["gpu_hosts"][0]["outcome"] == "unreadable"


def test_removed_card_goes_only_after_full_ok(tmp_path):
    reps = iter([v2([gpu(0), gpu(1)]), v2([gpu(0)])])
    p = gmake(tmp_path, lambda h, c: next(reps) if h.name == "gpubox" else v2([], tool="absent", query=None))
    p.poll_once()
    p.poll_once()
    assert [r["index"] for r in p.snapshot()["gpus"]] == [0]


def test_tool_absent_for_known_host_is_unreadable(tmp_path):
    reps = iter([v2([gpu(0)]), v2([], tool="absent", query=None)])
    p = gmake(tmp_path, lambda h, c: next(reps) if h.name == "gpubox" else v2([], tool="absent", query=None))
    p.poll_once()
    p.poll_once()
    assert p.snapshot()["gpu_hosts"][0]["outcome"] == "unreadable"
    assert p.snapshot()["gpus"][0]["state"] == "unreadable"


def test_legacy_rows_before_redeploy(tmp_path):
    def probe(h, c):
        if h.name != "gpubox":
            return v2([], tool="absent", query=None)
        r = ProbeReport(version=1, kind="linux")
        r.gpu_temps = [70.0]
        r.gpus = [Gpu(index=0, temp=70.0, detail=False)]
        r.gpu_query = "legacy"
        return r
    p = gmake(tmp_path, probe)
    p.poll_once()
    s = p.snapshot()
    assert s["gpu_hosts"][0]["outcome"] == "legacy"
    assert [(r["state"], r["temp"], r["detail"]) for r in s["gpus"]] == [("nodetail", 70.0, False)]
    c = HomelabCollector.__new__(HomelabCollector)
    c._poller = p
    m = c.collect()
    assert m["homelab.gpus"].value[0]["state"] == "nodetail"


def test_legacy_losing_temps_for_known_host_is_unreadable(tmp_path):
    def legacy(temps):
        r = ProbeReport(version=1, kind="linux")
        r.gpus = [Gpu(index=i, temp=t, detail=False) for i, t in enumerate(temps)]
        r.gpu_query = "legacy"
        return r
    reps = iter([legacy([70.0]), legacy([]), legacy([71.0])])
    p = gmake(tmp_path, lambda h, c: next(reps) if h.name == "gpubox" else v2([], tool="absent", query=None))
    outcomes = []
    for _ in range(3):
        p.poll_once()
        outcomes.append(p.snapshot()["gpu_hosts"][0]["outcome"])
    assert outcomes == ["legacy", "unreadable", "legacy"]


def test_restart_during_outage(tmp_path):
    p = gmake(tmp_path, lambda h, c: v2([gpu(0)]) if h.name == "gpubox" else v2([], tool="absent", query=None))
    p.poll_once()

    def down(h, c):
        raise CheckError("no connection")
    again = gmake(tmp_path, down)                 # same baseline file
    s = again.snapshot()
    assert s["gpus"] == [] and s["published_at"] is None       # before the first poll
    again.poll_once()
    s = again.snapshot()
    assert [(r["host"], r["state"]) for r in s["gpus"]] == [("gpubox", "offline")]
    assert s["gpu_hosts"][0]["outcome"] == "offline"


def test_pending_at_start(tmp_path):
    p = gmake(tmp_path, lambda h, c: v2([]))
    assert p.snapshot()["gpu_hosts"] == [{"host": "gpubox", "outcome": "pending"}, {"host": "devbox", "outcome": "pending"}]


def test_gpu_alert_survives_unreadable_and_na(tmp_path):
    reps = iter([v2([gpu(0, temp=95.0)])] * 4 + [v2([], query="fail")] * 3 +
                [v2([gpu(0, temp=None)])] * 3 + [v2([gpu(0, temp=60.0)])] * 2)
    p = gmake(tmp_path, lambda h, c: next(reps) if h.name == "gpubox" else v2([], tool="absent", query=None))
    for _ in range(4):
        p.poll_once()
    assert any(i["title"] == "GPU 0 95°C" for i in p.snapshot()["issues"])
    for _ in range(6):                           # failed query, then N/A temperature
        p.poll_once()
        assert any(i["title"].startswith("GPU 0") for i in p.snapshot()["issues"])
    for _ in range(2):                           # real healthy readings clear it
        p.poll_once()
    assert not any(i["title"].startswith("GPU 0") for i in p.snapshot()["issues"])


def test_two_gpus_one_alerted_both_recover(tmp_path):
    reps = iter([v2([gpu(0, temp=95.0), gpu(1, temp=60.0)])] * 4 + [v2([gpu(0, temp=60.0), gpu(1, temp=60.0)])] * 2)
    p = gmake(tmp_path, lambda h, c: next(reps) if h.name == "gpubox" else v2([], tool="absent", query=None))
    for _ in range(6):
        p.poll_once()
    assert p.snapshot()["issues"] == []


def test_published_at_and_stale_after(tmp_path):
    p = gmake(tmp_path, lambda h, c: v2([gpu(0)]) if h.name == "gpubox" else v2([], tool="absent", query=None), poll=10)
    p.poll_once()
    c = HomelabCollector.__new__(HomelabCollector)
    c._poller = p
    a, b = c.collect()["homelab.gpus"], c.collect()["homelab.gpus"]
    assert a.extra["published_at"] == b.extra["published_at"]          # frozen snapshot, same value
    assert a.extra["stale_after"] == 2 * (1.1 * 10 + 1 * 40)


def test_slow_polls_are_not_stale():
    """10 s polls, 30 s collections, 12 hosts (two batches): between two publications the
    age of the last one never exceeds stale_after."""
    import math
    poll, hosts = 10, 12
    stale_after = 2 * (1.1 * poll + math.ceil(hosts / 8) * 40)
    collection = 2 * 30                       # two batches of 30 s
    gap = collection + 1.1 * poll             # publish -> next publish, worst case
    assert gap < stale_after
```

- [ ] **Step 2: Run them and watch them fail**

Run: `.venv/bin/python -m pytest tests/test_homelab_collector.py -q`
Expected: KeyError on `gpus`.

- [ ] **Step 3: Implement `poller.py`**

```python
from chiketi.collectors.homelab.probe import ProbeReport
from chiketi.collectors.homelab.rules import gpu_keep_keys, gpu_state

_PROBED = ("linux", "unraid")


def gpu_outcome(rep: ProbeReport, has_known: bool) -> str:
    """ok / legacy / none / unreadable for a host that answered (spec §2)."""
    if rep.version < 2:
        if rep.gpus:
            return "legacy"
        return "unreadable" if has_known else "none"
    if rep.gpu_query == "ok" and rep.gpu_rows == len(rep.gpus):
        return "ok"
    if rep.gpu_query is None and rep.gpu_tool in ("absent", None):
        return "unreadable" if has_known else "none"
    return "unreadable"


def _row(host: str, g, state: str, seen_at: float) -> dict:
    return {"host": host, "index": g.index, "name": g.name, "util": g.util, "vram_used": g.vram_used,
            "vram_total": g.vram_total, "temp": g.temp, "power": g.power, "power_limit": g.power_limit,
            "fan": g.fan, "procs": g.procs, "state": state, "detail": g.detail, "seen_at": seen_at}
```

In `__init__`:

```python
        self._gpu_mem = baseline.gpu_memory()          # host -> (gpus, seen_at)
        self._gpu_outcome = {h.name: "pending" for h in cfg.hosts if h.kind in _PROBED}
```

The initial `_snap` gains `"gpus": [], "gpu_hosts": self._gpu_hosts(), "published_at": None, "host_count": len(cfg.hosts)`.

`_check` returns a third element, the report for a probed host that answered, else None:

```python
                try:
                    rep = self._probe(h, self._cfg)
                except CheckError as exc:
                    return [down(str(exc))], True, "offline"
                ...
                return conds, False, rep
            ...
        except Exception as exc:
            ...
            return [], True, None
```

All non-probe returns get `None` as the third element. A crashing rule returns `None`, which leaves the GPU state as it was.

In `poll_once`, replace the loop with:

```python
        start = time.monotonic()
        ...
        for h, (conds, partial, rep) in zip(hosts, results, strict=True):
            keep = None
            if h.kind in _PROBED and rep is not None:
                if rep == "offline":
                    self._gpu_outcome[h.name] = "offline"
                else:
                    known = self._gpu_mem.get(h.name)
                    outcome = gpu_outcome(rep, bool(known and known[0]))
                    self._gpu_outcome[h.name] = outcome
                    if outcome in ("ok", "legacy"):
                        if rep.gpus:
                            self._gpu_mem[h.name] = (list(rep.gpus), now)
                            self._baseline.remember_gpus(h.name, rep.gpus, now)
                        else:
                            self._gpu_mem.pop(h.name, None)
                            self._baseline.forget_gpus(h.name)
                        kk = gpu_keep_keys(rep)
                        keep = lambda k, kk=kk: k in kk          # noqa: E731
                    elif outcome == "none":
                        self._gpu_mem.pop(h.name, None)
                        self._baseline.forget_gpus(h.name)
                    else:                                         # unreadable: the sample is not used
                        conds = [c for c in conds if not c.key.startswith("gpu_temp:")]
                        keep = lambda k: k.startswith("gpu_temp:")  # noqa: E731
            self._tracker.update(h.name, conds, now, partial, keep=keep)
            ...
```

Then build the snapshot:

```python
        snap = {
            ...,
            "gpus": self._gpu_rows(),
            "gpu_hosts": self._gpu_hosts(),
            "published_at": now + (time.monotonic() - start),
            "host_count": len(hosts),
        }
```

with:

```python
    def _gpu_hosts(self) -> list[dict]:
        return [{"host": n, "outcome": o} for n, o in self._gpu_outcome.items()]

    def _gpu_rows(self) -> list[dict]:
        thr = self._cfg.thresholds
        rows = []
        for h in self._cfg.hosts:
            mem = self._gpu_mem.get(h.name)
            if h.kind not in _PROBED or not mem:
                continue
            outcome = self._gpu_outcome[h.name]
            as_of = "offline" if outcome == "pending" else outcome
            for g in sorted(mem[0], key=lambda g: g.index):
                rows.append(_row(h.name, g, gpu_state(g, thr, as_of), mem[1]))
        return rows
```

`self._gpu_outcome` keeps `homelab.toml` order (it is built from `cfg.hosts`).

- [ ] **Step 4: Implement `collector.py`** (inside `collect()` after the existing keys)

```python
        pub = snap.get("published_at")
        hosts = max(1, snap.get("host_count") or 1)
        poll = snap["poll_seconds"]
        thr = self._poller.thresholds() if hasattr(self._poller, "thresholds") else {}
        out[self._key("gpus")] = MetricValue(
            snap["gpus"], available=pub is not None,
            extra={"published_at": pub, "stale_after": 2 * (1.1 * poll + math.ceil(hosts / 8) * 40),
                   "warn_c": thr.get("gpu_warn_c"), "crit_c": thr.get("gpu_crit_c")})
        out[self._key("gpu_hosts")] = MetricValue(snap["gpu_hosts"], available=pub is not None)
```

Restructure `collect()` to build a dict `out` and return it. Add `def thresholds(self): return dict(self._cfg.thresholds)` to the poller, and `import math`.

- [ ] **Step 5: Run the tests and watch them pass; then run the full suite**

Run: `.venv/bin/python -m pytest -q`
Expected: all pass. Fix any existing test that unpacks `_check` results or compares whole snapshots.

- [ ] **Step 6: Commit** `feat(homelab): GPU outcomes per host, remembered GPUs, homelab.gpus metrics`

---

### Task 4: Wiring (`screens.json`, devices)

**Files:**
- Modify: `chiketi/assets/ui/screens.json` (`gpus` built + `needs: "homelab"`; Kiosk defaults)
- Modify the tests that assert the old defaults: `tests/test_screens.py`, `tests/test_devices.py`, `tests/test_server_devices.py`, `tests/test_state.py`, `tests/test_app.py`

- [ ] **Step 1: Update the tests first**
  - `test_screens.py`: `defaults("kiosk") == ["lab", "sessions", "gpus"]`, and built screens == `["lab", "sessions", "gpus"]`.
  - Every assertion of `["lab", "sessions"]` as a *default* becomes `["lab", "sessions", "gpus"]`. Find them with `grep -rn '"lab", "sessions"\]' tests/`, and leave assertions about *saved* lists alone.
  - Add to `test_devices.py`:

```python
def test_saved_screens_survive_new_defaults():
    r, _ = reg()
    r.kiosk_capable = True
    r.load({"wide": {"name": "Wide", "mode": "kiosk", "screens": ["lab", "sessions"], "caps": {}}})
    assert r.snapshot()["wide"]["screens"] == ["lab", "sessions"]
```

- [ ] **Step 2: Run and fail.** Then update `screens.json`: `"gpus": {"name": "GPUs", "label": "GPUS", "built": true, "color": "a1", "needs": "homelab"}`, and `"defaults": ["lab", "sessions", "gpus"]`.
- [ ] **Step 3: Run `pytest -q` and watch it pass.** (Harness changes come in Task 5; the harness may fail until then, so don't run it here.)
- [ ] **Step 4: Commit** `feat(screens): GPUs is built; new Kiosk displays get it by default`

---

### Task 5: The screen (`screen_functions.js`) and harness

**Files:**
- Modify: `chiketi/assets/ui/screen_functions.js`:
  - new GPUs section after Home Lab;
  - `KIOSK_RENDERERS`;
  - `bsTabAttention`.
- Modify: `tests/js/fixtures.js` (gpu fixtures; `FULL` keys), `tests/js/render_harness.js`

**Interfaces:**
- Produces:
  - `gpuHouseData() -> {mode, available, rows, hosts, stale, incomplete, invWarn, pub}`;
  - `gpuStatusColor(d)`;
  - `gpuPowerText(d)`;
  - `bsGpusScreen(c)`, `sfTosGpus(c)`, `claudeGpus(c)`;
  - rows carry `data-gpu-row`.

- [ ] **Step 1: Fixtures** (`fixtures.js`, after the Home Lab fixtures)

```js
function gpuRow(host, index, state, over) {
  return Object.assign({ host: host, index: index, name: 'Tesla V100-PCIE-32GB', util: 50, vram_used: 18432,
    vram_total: 32768, temp: 64, power: 180, power_limit: 250, fan: null, procs: 1, state: state,
    detail: true, seen_at: NOW_S - 5 }, over || {});
}
function gpuHouse(rows, hosts, over) {
  const f = Object.assign({}, FULL);
  f['homelab.gpus'] = mval(rows, '', Object.assign({ published_at: NOW_S - 5, stale_after: 160,
    warn_c: 85, crit_c: 92 }, over || {}));
  f['homelab.gpu_hosts'] = mval(hosts || [{ host: 'gpubox', outcome: 'ok' }, { host: 'devbox', outcome: 'none' }]);
  return f;
}
```

`FULL` gains (in its literal, so FULL defines every key):

```js
  'homelab.gpus': mval([
    { host: 'gpubox', index: 0, name: 'Tesla V100-PCIE-32GB', util: 87, vram_used: 30100, vram_total: 32768,
      temp: 71, power: 231, power_limit: 250, fan: null, procs: 2, state: 'busy', detail: true, seen_at: Math.floor(Date.now() / 1000) - 5 },
    { host: 'gpubox', index: 1, name: 'Tesla V100-PCIE-32GB', util: 0, vram_used: 4, vram_total: 32768,
      temp: 38, power: 26, power_limit: 250, fan: null, procs: 0, state: 'idle', detail: true, seen_at: Math.floor(Date.now() / 1000) - 5 },
  ], '', { published_at: Math.floor(Date.now() / 1000) - 5, stale_after: 160, warn_c: 85, crit_c: 92 }),
  'homelab.gpu_hosts': mval([{ host: 'gpubox', outcome: 'ok' }, { host: 'devbox', outcome: 'none' }]),
```

Then the named fixtures, exported:
- `GPU_HOUSE`: one row per state, in a mixed order:

```js
const GPU_STATES = ['idle', 'busy', 'unknown', 'nodetail', 'offline', 'unreadable', 'throttling', 'hot', 'critical'];
const GPU_HOUSE = gpuHouse(GPU_STATES.map(function (s, i) {
  return gpuRow(i < 5 ? 'gpubox' : 'devbox', i, s, s === 'nodetail' ? { util: null, vram_used: null, vram_total: null,
    power: null, power_limit: null, procs: null, detail: false } : s === 'critical' ? { temp: 95 } : s === 'hot' ? { temp: 87 } : {});
}), [{ host: 'gpubox', outcome: 'ok' }, { host: 'devbox', outcome: 'ok' }]);
```

- the rest:

```js
const GPU_HOUSE_NONE = gpuHouse([], [{ host: 'gpubox', outcome: 'none' }]);
const GPU_HOUSE_INCOMPLETE = gpuHouse([], [{ host: 'gpubox', outcome: 'offline' }]);
const GPU_HOUSE_INCOMPLETE_WITH_ROWS = gpuHouse([gpuRow('gpubox', 0, 'busy')],
  [{ host: 'gpubox', outcome: 'ok' }, { host: 'a-very-long-host-name-<b>x</b>', outcome: 'pending' }]);
const GPU_HOUSE_STALE = gpuHouse([gpuRow('gpubox', 0, 'critical', { temp: 95 })], null, { published_at: NOW_S - 9999 });
const GPU_HOUSE_SPARSE = gpuHouse([gpuRow('gpubox', 0, 'unknown', { util: null, vram_used: null, vram_total: 0,
  temp: null, power: null, power_limit: null, procs: null })]);
const GPU_HOUSE_MIXED_POWER = gpuHouse([gpuRow('gpubox', 0, 'busy'), gpuRow('gpubox', 1, 'idle', { power: null }),
  gpuRow('devbox', 0, 'offline')]);
const GPU_HOUSE_ONE_OFFLINE = gpuHouse([gpuRow('gpubox', 0, 'busy', { power: 100 }), gpuRow('gpubox', 1, 'offline')]);
const GPU_HOUSE_MANY = gpuHouse(Array.from({ length: 12 }, function (_, i) { return gpuRow('gpubox', i, i % 2 ? 'idle' : 'busy'); }));
const GPU_HOUSE_HOSTILE = gpuHouse([gpuRow(XSS, 0, 'busy', { name: XSS }), gpuRow('gpubox', 1, XSS)],
  [{ host: XSS, outcome: 'pending' }, { host: 'gpubox', outcome: 'ok' }]);
```

- [ ] **Step 2: Harness checks** (`render_harness.js`)
  - Add `GPU_HOUSE_HOSTILE` to the hostile fixture list in the main loop (the `fixtureName === 'HOSTILE' || …` test).
  - The plan check's `READY` becomes `{FULL: ['lab','sessions','gpus'], HL_UNCONFIGURED: ['sessions'], SESS_UNCONFIGURED: ['lab','gpus'], KIOSK_EMPTY: []}`.
  - In the main per-fixture loop, add:

```js
      if (/Gpus$/.test(fn.name)) {
        const want = { FULL: '2 GPUS', GPU_HOUSE_NONE: 'NO GPUS REPORTED', GPU_HOUSE_INCOMPLETE: 'GPU INVENTORY INCOMPLETE',
                       GPU_HOUSE_INCOMPLETE_WITH_ROWS: 'NOT REACHED', GPU_HOUSE_STALE: 'TELEMETRY STALE',
                       GPU_HOUSE_MIXED_POWER: 'W FROM 1 OF 3 GPUS', GPU_HOUSE_ONE_OFFLINE: '100 W FROM 1 OF 2 GPUS',
                       HL_PENDING: 'ACQUIRING TELEMETRY' }[fixtureName];
        if (want && html.indexOf(want) === -1) fail(fixtureName, label, 'missing "' + want + '"');
        if (fixtureName === 'FULL' && html.indexOf('W NOW') === -1) fail(fixtureName, label, 'no W NOW total');
        if (fixtureName === 'GPU_HOUSE_ONE_OFFLINE' && html.indexOf('W NOW') !== -1) fail(fixtureName, label, 'subtotal sold as W NOW');
        if (fixtureName === 'GPU_HOUSE_NONE' && html.indexOf('-- W') !== -1) fail(fixtureName, label, 'power shown for no GPUs');
        if (fixtureName === 'GPU_HOUSE_STALE' && html.indexOf('CRITICAL') === -1) fail(fixtureName, label, 'cached CRITICAL word lost');
        if (fixtureName === 'GPU_HOUSE_SPARSE' && (/>\s*0%\s*</.test(html) || /NaN/.test(html))) fail(fixtureName, label, 'missing value shown as 0% or NaN');
        if (fixtureName === 'GPU_HOUSE_MANY' && !/\+\d+ MORE/.test(html)) fail(fixtureName, label, 'GPUs dropped silently');
        if (html.indexOf('screen-frame fluid') === -1) fail(fixtureName, label, 'GPUs must be fluid');
      }
```

(Empty states don't print a power line; the `GPU_HOUSE_NONE` assertion guards that.)

  - After the plan block, a GPUs block:

```js
/* ── GPUs: every state word on its own, order worst first, overflow counts,
   status colour precedence. ── */
(function () {
  const LABEL = { critical: 'CRITICAL', hot: 'HOT', throttling: 'THROTTLING', unreadable: 'UNREADABLE',
                  offline: 'OFFLINE', nodetail: 'NO DETAIL', unknown: 'UNKNOWN', busy: 'BUSY', idle: 'IDLE' };
  const fv = ['Sci-Fi', 'TOS'];
  activeFamily = fv[0];
  const colors = FAMILIES[fv[0]][fv[1]];
  [600, 246].forEach(function (h) {
    setFrameH(h);
    Object.keys(LABEL).forEach(function (st) {
      const row = { host: 'gpubox', index: 0, name: 'V100', util: 50, vram_used: 1, vram_total: 2, temp: st === 'critical' ? 95 : st === 'hot' ? 87 : 60,
                    power: 1, power_limit: 2, fan: null, procs: 1, state: st, detail: st !== 'nodetail', seen_at: Math.floor(Date.now() / 1000) };
      metrics = Object.assign({}, FIX.FULL, { 'homelab.gpus': Object.assign({}, FIX.FULL['homelab.gpus'], { value: [row] }) });
      const html = sfTosGpus(colors);
      if (html.indexOf(LABEL[st]) === -1) fail('GPUS', st + ' h=' + h, 'state word missing');
    });
    metrics = FIX.GPU_HOUSE;
    const html = sfTosGpus(colors);
    const order = ['CRITICAL', 'HOT', 'THROTTLING', 'UNREADABLE', 'OFFLINE', 'NO DETAIL', 'UNKNOWN', 'BUSY', 'IDLE']
      .map(function (w) { return html.indexOf('>' + w + '<'); }).filter(function (i) { return i !== -1; });
    for (let i = 1; i < order.length; i++) if (order[i] < order[i - 1]) fail('GPUS', 'order h=' + h, 'not worst first');
    metrics = FIX.GPU_HOUSE_MANY;
    const many = sfTosGpus(colors);
    const shown = (many.match(/data-gpu-row/g) || []).length;
    const more = /\+(\d+) MORE/.exec(many);
    if (!more || Number(more[1]) !== 12 - shown) fail('GPUS', 'overflow h=' + h, 'MORE count ' + (more && more[1]) + ' with ' + shown + ' shown');
  });
  setFrameH(600);
  bsSkin(BS_SKIN_TOS);
  metrics = FIX.GPU_HOUSE_STALE;
  if (gpuStatusColor(gpuHouseData()) !== bsS().warn) fail('GPUS', 'stale+critical', 'status must be warn when stale');
  if (bsTabAttention().gpus !== bsS().warn) fail('GPUS', 'stale+critical', 'tab must be warn when stale');
  metrics = FIX.GPU_HOUSE;
  if (gpuStatusColor(gpuHouseData()) !== bsS().crit || bsTabAttention().gpus !== bsS().crit) fail('GPUS', 'critical', 'not crit');
  metrics = FIX.GPU_HOUSE_INCOMPLETE_WITH_ROWS;
  if (gpuStatusColor(gpuHouseData()) !== bsS().edge) fail('GPUS', 'pending host with rows', 'must not warn');
  metrics = FIX.GPU_HOUSE_INCOMPLETE;
  if (gpuStatusColor(gpuHouseData()) !== bsS().warn) fail('GPUS', 'no rows, host offline', 'must warn');
  metrics = FIX.FULL;
})();
```

- [ ] **Step 3: Run the harness and watch it fail** (`node tests/js/render_harness.js`). Expected: `ReferenceError: sfTosGpus`, or REGISTRY failing for the `gpus` renderer.

- [ ] **Step 4: Implement** in `screen_functions.js`, after the Home Lab wrappers:

```js
/* ── GPUs ───────────────────────────────────────────────────────────────
 * Every NVIDIA GPU the Home Lab probe sees, worst first: what it is doing,
 * how full and hot it is, and -- when a host is gone or its driver answers
 * nothing -- the last reading, dimmed, with its age. Same chrome as Sessions. */
const GPU_ORDER = { critical: 0, hot: 1, throttling: 2, unreadable: 3, offline: 4, nodetail: 5, unknown: 6, busy: 7, idle: 8 };
const GPU_LABEL = { critical: 'CRITICAL', hot: 'HOT', throttling: 'THROTTLING', unreadable: 'UNREADABLE',
                    offline: 'OFFLINE', nodetail: 'NO DETAIL', unknown: 'UNKNOWN', busy: 'BUSY', idle: 'IDLE' };
const GPU_COLS = [
  { key: 'name', label: 'GPU', w: null },
  { key: 'state', label: 'STATE', w: 132 },
  { key: 'load', label: 'LOAD', w: 128 },
  { key: 'vram', label: 'VRAM', w: 160 },
  { key: 'temp', label: 'TEMP', w: 62, align: 'right' },
  { key: 'power', label: 'POWER', w: 112, align: 'right' },
  { key: 'procs', label: 'PROCS', w: 56, align: 'right' },
];

function gpuFin(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function gpuStateColor(st) {
  const S = bsS();
  return st === 'critical' ? S.crit
    : (st === 'hot' || st === 'throttling' || st === 'unreadable' || st === 'offline') ? S.warn
    : st === 'busy' ? S.a4 : st === 'idle' ? S.label : S.dim;
}
function gpuHouseData() {
  const hl = hlData();
  const gm = m('homelab.gpus'), hm = m('homelab.gpu_hosts');
  const isObj = function (x) { return x && typeof x === 'object'; };
  const hosts = (hm.available && Array.isArray(hm.value)) ? hm.value.filter(isObj) : [];
  const hostOrder = {};
  hosts.forEach(function (h, i) { hostOrder[String(h.host)] = i; });
  const rows = ((gm.available && Array.isArray(gm.value)) ? gm.value.filter(isObj) : []).map(function (r) {
    return Object.assign({}, r, { state: GPU_ORDER[r.state] !== undefined ? r.state : 'unknown',
                                  host: String(r.host == null ? '' : r.host), index: gpuFin(r.index) || 0 });
  });
  rows.sort(function (a, b) {
    return (GPU_ORDER[a.state] - GPU_ORDER[b.state]) ||
      ((hostOrder[a.host] === undefined ? 99 : hostOrder[a.host]) - (hostOrder[b.host] === undefined ? 99 : hostOrder[b.host])) ||
      (a.index - b.index);
  });
  const ex = gm.extra || {};
  const pub = gpuFin(ex.published_at), after = gpuFin(ex.stale_after);
  const stale = !!(gm.available && pub !== null && after !== null && after > 0 && Date.now() / 1000 - pub > after);
  const withRows = {};
  rows.forEach(function (r) { withRows[r.host] = true; });
  const incomplete = hosts.filter(function (h) {
    return (h.outcome === 'pending' || h.outcome === 'offline' || h.outcome === 'unreadable') && !withRows[String(h.host)];
  });
  const invWarn = incomplete.length > 0 && (rows.length === 0 || incomplete.some(function (h) { return h.outcome === 'unreadable'; }));
  return { mode: hl.mode, available: !!gm.available, rows: rows, hosts: hosts, stale: stale,
           incomplete: incomplete, invWarn: invWarn, pub: pub };
}
function gpuFresh(d, r) { return !d.stale && r.state !== 'offline' && r.state !== 'unreadable'; }
function gpuStatusColor(d) {
  const S = bsS();
  if (d.stale) return S.warn;
  if (d.rows.some(function (r) { return r.state === 'critical'; })) return S.crit;
  if (d.invWarn || d.rows.some(function (r) {
    return r.state === 'hot' || r.state === 'throttling' || r.state === 'unreadable' || r.state === 'offline';
  })) return S.warn;
  return S.edge;
}
function gpuPowerText(d) {
  const n = d.rows.length;
  let a = 0, w = 0;
  d.rows.forEach(function (r) { const p = gpuFin(r.power); if (gpuFresh(d, r) && p !== null) { a++; w += p; } });
  if (d.stale || a === 0) return '-- W';
  return a === n ? Math.round(w) + ' W NOW' : Math.round(w) + ' W FROM ' + a + ' OF ' + n + ' GPUS';
}
function gpuHostList(list) {
  const names = list.map(function (h) { return esc(String(h.host)); });
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ' +' + (names.length - 3) : '');
}
function gpuFooterText(d) {
  const busy = d.rows.filter(function (r) { return r.state === 'busy'; }).length;
  const parts = [d.rows.length + ' GPU' + (d.rows.length === 1 ? '' : 'S'), busy + ' BUSY', gpuPowerText(d),
                 'CHECKED ' + (d.pub ? sessAge(d.pub) + ' AGO' : 'NEVER')];
  const old = [];
  d.rows.forEach(function (r) { if (r.state === 'nodetail' && old.indexOf(r.host) === -1) old.push(r.host); });
  if (old.length) parts.push(gpuHostList(old.map(function (h) { return { host: h }; })) + ' NEED THE NEW PROBE');
  if (d.incomplete.length) parts.push('NOT REACHED: ' + gpuHostList(d.incomplete));
  return parts.join(' · ');
}
function gpuVram(r) {
  const used = gpuFin(r.vram_used), tot = gpuFin(r.vram_total);
  const pct = used !== null && tot !== null && tot > 0 ? Math.max(0, Math.min(100, used / tot * 100)) : null;
  const text = used !== null && tot !== null && tot > 0
    ? (used / 1024).toFixed(1) + ' / ' + Math.round(tot / 1024) + ' G' : '--';
  return { pct: pct, text: text };
}
function bsGpuRow(d, r, rowH, k, cols, compact) {
  const S = bsS();
  const col = gpuStateColor(r.state);
  const fresh = gpuFresh(d, r);
  const util = gpuFin(r.util), temp = gpuFin(r.temp), pw = gpuFin(r.power), lim = gpuFin(r.power_limit);
  const procs = gpuFin(r.procs);
  const v = gpuVram(r);
  const C = {};
  cols.forEach(function (c) { C[c.key] = c; });
  const title = 'GPU ' + r.index + (r.name ? ' · ' + esc(String(r.name)) : '');
  const nameCell = compact
    ? `<span style="color:${S.bright};font-size:${gq(17 * k)};font-weight:${S.fw}">${title}</span>` +
      `<span style="color:${S.label};font-size:${gq(13 * k)}"> · ${esc(r.host)}</span>`
    : `<div style="color:${fresh ? S.bright : S.label};font-size:${gq(22 * k)};font-weight:${S.fw};overflow:hidden;` +
        `text-overflow:ellipsis">${title}</div><div style="color:${S.label};font-size:${gq(14 * k)};overflow:hidden;` +
        `text-overflow:ellipsis">${esc(r.host)}</div>`;
  const stateCell = `<div style="color:${col};letter-spacing:0.12em;font-size:${gq(14 * k)};${bsGlow(8, col)}">${GPU_LABEL[r.state]}</div>` +
    (fresh || compact ? '' : `<div style="color:${S.dim};font-size:${gq(11 * k)};letter-spacing:0.08em">SEEN ${r.seen_at ? sessAge(r.seen_at) + ' AGO' : '--'}</div>`);
  const bar = function (pct, color, w) {
    return `<span style="display:inline-flex;vertical-align:middle;margin-right:${gq(8)}">${bsSegBar(pct === null ? 0 : pct, color, w, 12 * k, 10, 2)}</span>`;
  };
  const loadCell = compact ? (util === null ? '--' : Math.round(util) + '%')
    : bar(util, col === S.label ? S.a4 : col, 64) + (util === null ? '--' : Math.round(util) + '%');
  const vramCell = compact ? (v.pct === null ? '--' : Math.round(v.pct) + '%') : bar(v.pct, S.a2, 56) + v.text;
  const tempCell = temp === null ? '--' : Math.round(temp) + '&deg;';
  const powerCell = pw === null ? '--' : Math.round(pw) + (lim !== null && !compact ? ' / ' + Math.round(lim) : '') + ' W';
  const cells = {
    name: sessCell(C.name, nameCell),
    state: sessCell(C.state, stateCell),
    load: sessCell(C.load, loadCell, `color:${S.soft};font-size:${gq(17 * k)};font-variant-numeric:tabular-nums`),
    vram: sessCell(C.vram, vramCell, `color:${S.soft};font-size:${gq(17 * k)};font-variant-numeric:tabular-nums`),
    temp: sessCell(C.temp, tempCell, `color:${temp === null ? S.dim : S.therm(temp)};font-size:${gq(19 * k)};font-variant-numeric:tabular-nums`),
    power: sessCell(C.power, powerCell, `color:${S.soft};font-size:${gq(17 * k)};font-variant-numeric:tabular-nums`),
    procs: C.procs ? sessCell(C.procs, procs === null ? '--' : String(procs), `color:${procs ? S.a2 : S.dim};font-size:${gq(17 * k)}`) : '',
  };
  return `<div data-gpu-row style="display:flex;align-items:center;gap:${gq(SESS_GAP)};height:${gq(rowH)};flex-shrink:0;` +
      `padding:0 ${gq(16)};border-bottom:${gq(1)} solid ${S.edge};${fresh ? '' : 'opacity:0.6;'}">` +
    `<span style="display:flex;width:${gq(SESS_LAMP * 1.5)};flex-shrink:0">${bsTabIcon('gpus', col, SESS_LAMP * 1.4 * Math.min(1, k + 0.2))}</span>` +
    cols.map(function (c) { return cells[c.key]; }).join('') + `</div>`;
}
function bsGpuHeadings(cols, h, px) {
  const S = bsS();
  return `<div style="display:flex;align-items:center;gap:${gq(SESS_GAP)};padding:0 ${gq(16)};height:${gq(h)};` +
      `flex-shrink:0;color:${S.label};font-size:${gq(px)};letter-spacing:${S.ls}">` +
    `<span style="width:${gq(SESS_LAMP * 1.5)};flex-shrink:0"></span>` +
    cols.map(function (c) { return sessCell(c, c.label); }).join('') + `</div>`;
}
function gpuEmptyNote(d) {
  if (d.mode === 'unconfigured') return ['HOME LAB NOT CONFIGURED', bsS().dim];
  if (d.mode === 'pending' || !d.available) return ['ACQUIRING TELEMETRY', bsS().dim];
  if (!d.rows.length && d.invWarn) return ['GPU INVENTORY INCOMPLETE — ' + gpuHostList(d.incomplete), bsS().warn];
  if (!d.rows.length) return ['NO GPUS REPORTED', bsS().dim];
  return null;
}
function bsGpusScreen(c) {
  if (layoutClass() === 'strip') return bsGpusStrip(c);
  const S = bsS();
  const d = gpuHouseData();
  const H = fluidH();
  const status = gpuStatusColor(d);
  const ROW = 64, GAP = 6, TOP = 118, FOOT = 40, BANNER = d.stale ? 34 : 0;
  const bodyH = H - TOP - FOOT;
  const rowsH = bodyH - 34 - BANNER;
  const fit = Math.max(1, Math.floor((rowsH + GAP) / (ROW + GAP)));
  const shown = d.rows.length > fit ? d.rows.slice(0, fit - 1) : d.rows;
  const rowH = d.rows.length > fit ? ROW
    : Math.min(80, Math.max(ROW, Math.floor((rowsH * 0.8 + GAP) / Math.max(1, shown.length) - GAP)));
  const k = rowH / 64;
  const more = d.rows.length - shown.length;
  const empty = gpuEmptyNote(d);
  let body;
  if (empty) {
    body = `<div style="height:100%;display:flex;align-items:center;justify-content:center;text-align:center;color:${empty[1]};` +
      `font-size:${gq(34)};letter-spacing:${S.ls};${bsGlow(14, empty[1])}">${empty[0]}</div>`;
  } else {
    body = (d.stale ? `<div style="height:${gq(BANNER)};color:${S.warn};font-size:${gq(18)};letter-spacing:${S.ls};` +
        `${bsGlow(8, S.warn)}">TELEMETRY STALE · LAST UPDATE ${d.pub ? sessAge(d.pub) + ' AGO' : 'NEVER'}</div>` : '') +
      bsGpuHeadings(GPU_COLS, 34, 11.5) +
      `<div style="display:flex;flex-direction:column;gap:${gq(GAP)}">` +
      shown.map(function (r) { return bsGpuRow(d, r, rowH, k, GPU_COLS, false); }).join('') + `</div>` +
      (more > 0 ? `<div style="color:${S.label};font-size:${gq(17)};letter-spacing:${S.ls};` +
        `padding:${gq(10)} ${gq(16)} 0 ${gq(52)}">+${more} MORE</div>` : '');
  }
  const foot = empty ? '' : gpuFooterText(d);
  const inner = `<div style="position:absolute;left:0;right:0;top:50%;height:${gq(H)};transform:translateY(-50%)">` +
    `<div style="position:absolute;left:0;right:0;top:0;height:${gq(6)};background:${status};` +
      (status === S.edge ? '' : `box-shadow:0 0 ${gq(14)} ${status}88;`) + `"></div>` +
    bsHeader('gpus') +
    `<div style="position:absolute;left:${gq(28)};right:${gq(28)};top:${gq(TOP)};height:${gq(bodyH)};overflow:hidden">${body}</div>` +
    `<div style="position:absolute;left:${gq(28)};right:${gq(28)};bottom:${gq(10)};height:${gq(22)};color:${S.dim};` +
      `font-size:${gq(13)};letter-spacing:${S.ls};text-transform:uppercase;white-space:nowrap;overflow:hidden;` +
      `text-overflow:ellipsis">${foot}</div></div>`;
  return bsFrame(inner, true);
}
const GPU_STRIP_COLS = [
  { key: 'name', label: 'GPU', w: null },
  { key: 'state', label: 'STATE', w: 120 },
  { key: 'load', label: 'LOAD', w: 60, align: 'right' },
  { key: 'vram', label: 'VRAM', w: 60, align: 'right' },
  { key: 'temp', label: 'TEMP', w: 56, align: 'right' },
  { key: 'power', label: 'POWER', w: 76, align: 'right' },
];
function bsGpusStrip(c) {
  const S = bsS();
  const d = gpuHouseData();
  const H = frameH();
  const status = gpuStatusColor(d);
  const TOP = STRIP.TOP, HEAD = 22, FOOT = STRIP.FOOT, GAP = 4;
  const rowsH = H - TOP - HEAD - FOOT - 6;
  const ROW = 34;
  const fit = Math.max(1, Math.floor((rowsH + GAP) / (ROW + GAP)));
  const shown = d.rows.length > fit ? d.rows.slice(0, fit - 1) : d.rows;
  const more = d.rows.length - shown.length;
  const rowH = Math.min(56, Math.floor((rowsH + GAP) / Math.max(1, shown.length) - GAP));
  const empty = gpuEmptyNote(d);
  const busy = d.rows.filter(function (r) { return r.state === 'busy'; }).length;
  const hot = d.rows.filter(function (r) { return r.state === 'hot' || r.state === 'critical'; }).length;
  let lead = d.stale ? 'TELEMETRY STALE'
    : empty ? '' : d.rows.length + ' GPU' + (d.rows.length === 1 ? '' : 'S') + ' · ' + busy + ' BUSY · ' + hot + ' HOT';
  if (!empty && d.incomplete.length) lead += ' · NOT REACHED: ' + gpuHostList(d.incomplete);
  const body = empty
    ? `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:${empty[1]};` +
        `font-size:${gq(22)};letter-spacing:${S.ls};${bsGlow(10, empty[1])}">${empty[0]}</div>`
    : bsGpuHeadings(GPU_STRIP_COLS, HEAD, 9.5) + `<div style="display:flex;flex-direction:column;gap:${gq(GAP)}">` +
      shown.map(function (r) { return bsGpuRow(d, r, rowH, Math.min(0.9, rowH / 46), GPU_STRIP_COLS, true); }).join('') + `</div>`;
  return bsStripFrame({ active: 'gpus', status: status, lead: lead, leadColor: status === S.edge ? S.label : status,
                        body: body, foot: empty ? '' : gpuPowerText(d) + ' · CHECKED ' + (d.pub ? sessAge(d.pub) + ' AGO' : 'NEVER'),
                        footColor: S.dim, more: more });
}
function sfTosGpus(c) { bsSkin(BS_SKIN_TOS); return bsGpusScreen(c); }
function claudeGpus(c) { bsSkin(BS_SKIN_CLAUDE); return bsGpusScreen(c); }
```

- `KIOSK_RENDERERS`: add `gpus: sfTosGpus` to TOS and `gpus: claudeGpus` to Claude.
- `bsTabAttention`: add

```js
    gpus: (function () {
      if (!hlConfigured()) return null;
      const g = gpuHouseData(), col = gpuStatusColor(g);
      return col === S.crit ? S.crit : col === S.warn ? S.warn : null;
    })(),
```

- The strip lead text may be long. `bsStripFrame`'s lead is `white-space:nowrap`. If `fit_check` reports clipping, cut `lead` to fit (for example, at most 2 host names).

- [ ] **Step 5: Run harness + check_js and watch them pass**: `node tests/js/render_harness.js && ./scripts/check_js.sh`. Then mutation-check one claim: make `gpuStatusColor` ignore `d.stale` → the harness must fail `stale+critical`. Restore.

- [ ] **Step 6: Commit** `feat(ui): the GPUs screen -- every GPU in the house, worst first, honest about old data`

---

### Task 6: Browser checks

**Files:** `scripts/fit_check.mjs` (readiness from `screens.json` needs), `scripts/devices_check.mjs` (step 2 defaults)

- [ ] **Step 1:** in `fit_check.mjs`, replace `ready()` with a needs-based one:

```js
const SPEC = JSON.parse(readFileSync(new URL('../chiketi/assets/ui/screens.json', import.meta.url)));
const ready = (metrics) => KIOSK.filter(id => {
  const s = SPEC.screens[id];
  if (!s.built) return false;
  if (!s.needs) return true;
  const st = metrics[s.needs + '.status'];
  return !!(st && st.available && st.value !== 'unconfigured');
});
```

  (Import `readFileSync` from `node:fs`.) The default `CASES` gain `gpus:FULL,gpus:GPU_HOUSE,gpus:GPU_HOUSE_MANY`.
- [ ] **Step 2:** in `devices_check.mjs`, step 2 additionally checks `s.screens.join() === 'lab,sessions,gpus'`.
- [ ] **Step 3:** run against a fresh dev server (with `sessions.toml` as before):

```bash
node scripts/devices_check.mjs
SHAPES=1800x1200,1920x462 TABS=2 CASES=gpus:FULL,gpus:GPU_HOUSE,gpus:GPU_HOUSE_MANY node scripts/fit_check.mjs
SHAPES=1800x1200,1920x462 TABS=7 CASES=gpus:FULL,gpus:GPU_HOUSE node scripts/fit_check.mjs
SHAPES=1800x1200,1920x462 node scripts/fit_check.mjs
```

  Expected: all ok. Look at the 1920×462 and 1800×1200 `GPU_HOUSE` screenshots by eye.
- [ ] **Step 4: Commit** `test: GPUs in the browser checks`

---

### Task 7: Docs and gate

- [ ] `README.md`: the Screens table gains a Kiosk **GPUs** row: "Every NVIDIA GPU on the Home Lab hosts: load, VRAM, temperature, power, state (busy, idle, hot, throttling, offline), worst first. Needs `homelab.toml` and the version-2 probe on each GPU host." Also add GPUs to the list of Kiosk screens in the modes paragraph.
- [ ] `CHANGELOG.md`: a "GPUs screen" entry under Unreleased, plus "probe v2 (redeploy with `chiketi-site deploy probe`)".
- [ ] `CLAUDE.md` Collectors/Home Lab paragraph: one sentence on GPU samples (outcomes, remembered GPUs in the baseline, alerts clear only on evidence).
- [ ] Run the full gate (pytest, harness, check_js, ruff, site check, gen_site_assets with clean `docs/`, shellcheck), then commit `docs: GPUs screen`.

---

## Revisions from review (binding: each overrides the task text it names)

**R1 (Task 5, harness).** Outside the eval, use `bsSkin(__HARNESS.skins[0])` (TOS) and
`__HARNESS.skins[1]` (Claude); `BS_SKIN_TOS` is not visible there.

**R2 (Task 2).** Add `import pytest` to `tests/test_homelab_rules.py`. The rules test imports become
`from chiketi.collectors.homelab.rules import IssueTracker, gpu_condition, gpu_keep_keys, gpu_state, throttling`
plus `from chiketi.collectors.homelab.config import DEFAULT_THRESHOLDS`.

**R3 (Task 1, timeout test).**
- `NEEDED` gains `sleep` and `date`.
- `_controlled_probe` asserts the probe exited 0 (`check=True`).
- The hang test's fake does `echo started >> "$ARGLOG"; sleep 30`. The test asserts:
  - `gpu_query == ["fail|124"]` (timeout's status);
  - `started` is in the arg log;
  - the whole probe took under 20 s (measure with `time.monotonic()`).

**R4 (Task 3, start-up).**
- **Remembered hosts start as `offline`:** `self._gpu_outcome[h] = "offline" if h in self._gpu_mem else "pending"`.
- **The initial snapshot's rows come from memory:** `"gpus": self._gpu_rows()`, built after `_gpu_mem` and `_gpu_outcome` are set, with `seen_at` preserved.
- **Metric availability stays gated:** `published_at` is None until the first poll, and the collector marks both metrics unavailable until then.
- **`_gpu_rows`** maps outcome `pending` to `offline` only for safety. With R4 a remembered host is never pending.
- `test_restart_during_outage` asserts that **before** the first poll `gpu_hosts[0].outcome == "offline"` and `gpus == [remembered row, offline]`, and that after the poll it is the same.

**R5 (Task 5, prototype-safe maps).** In `gpuHouseData` and `gpuFooterText`, use `new Set()` for
row hosts and `new Map()` for host order. `GPU_HOUSE_INCOMPLETE_WITH_ROWS` gains a second
incomplete host named `constructor` (outcome `unreadable`), and the harness asserts that this
fixture's status is **warn** (an unreadable host is incomplete). The plain pending-host fixture
`GPU_HOUSE_PENDING_WITH_ROWS` (healthy row + pending host) must stay calm (edge).

**R6 (Task 5, strip ages).** A compact row that is not fresh shows `SEEN <age>` after the state word
(`OFFLINE · 5m`). The strip state column widens to 150 and the name column absorbs it. Harness:
for `offline`, `unreadable` and `GPU_HOUSE_STALE` at h=246, the html contains `SEEN` or `· <age>`.
To make that checkable, the compact form is literally `SEEN 5m`.

**R7 (Task 5, a stale empty snapshot).** The stale banner (full) and the `TELEMETRY STALE` lead
(strip) are drawn whatever the body is. In the full layout, the banner sits above the empty note
too. New fixture `GPU_HOUSE_STALE_EMPTY` (no rows, stale): the html contains both `TELEMETRY STALE`
and `NO GPUS REPORTED`.

**R8 (Task 3, real tests).** Replace `test_slow_polls_are_not_stale` and strengthen the alert tests:

```python
def test_slow_polls_are_not_stale_through_the_poller(tmp_path, monkeypatch):
    """12 hosts, 10 s polls, every check takes 30 s of (fake) time: the published
    snapshot's age stays under stale_after until the next publication."""
    from chiketi.collectors.homelab import poller as P
    hosts = tuple(Host(f"h{i}", "linux", address="a", user="u") for i in range(12))
    t = {"now": 0.0, "mono": 0.0}
    monkeypatch.setattr(P.time, "monotonic", lambda: t["mono"])

    def slow(h, c):
        t["mono"] += 30.0 / 8          # 12 checks in two batches of eight: ~2 x 30 s
        return v2([], tool="absent", query=None)
    cfg = HomelabConfig(hosts=hosts, poll_seconds=10)
    p = HomelabPoller(cfg, Baseline(str(tmp_path / "b.json")), clock=lambda: t["now"], probe=slow)
    c = HomelabCollector.__new__(HomelabCollector)
    c._poller = p
    p.poll_once()
    first = c.collect()["homelab.gpus"].extra
    gap = (t["mono"] - 0) + 1.1 * 10 + 60          # this poll's length + max wait + next poll's length
    assert first["published_at"] + gap - first["published_at"] < first["stale_after"]
    assert first["published_at"] > 0             # stamped at the END of the poll, not its start
```

Also add, through the real poller with `gmake`:
- **Throttle mask lost:** a raised throttling issue stays while `throttle=None` (temperature fine), and clears after two readings with `throttle=0`. Assert after **every** cycle.
- **One GPU unknown, one recovers:** GPU 0 and GPU 1 both alerted. Then GPU 0 reads `temp=None` and GPU 1 reads healthy. After two cycles GPU 1's issue is gone and GPU 0's remains.
- **Unreadable keeps GPU alerts, clears other issues:** an alerted GPU plus a memory issue on the same host. Then `gpu_query=fail` with healthy memory. After two cycles memory is gone and the GPU issue remains.
- **Oscillation:** temp 86, 84, 86, 84 … for eight cycles. Assert no flapping: once raised, it stays raised while it alternates (the tracker clears only after 2 good in a row).
- **Offline cycle:** an alerted GPU, then a probe failure (partial), then healthy. The alert stays through the offline cycle and clears after two healthy ones.
- **Legacy end to end:** feed `parse_probe("probe_version=1\nkind=linux\ngpu_temp_c=88\n")` through a probe stub, then the poller, then the collector. Assert the row is `nodetail`, temp 88, and that after `HOLD_TEMP` polls a `GPU 0 88°C` warn issue is raised.
- `test_two_gpus_one_alerted_both_recover` asserts that the issue **is** raised after the fourth poll before asserting that it clears.

**R9 (Task 6, browser).**
- Update `devices_check.mjs` step 13. After `{mode: 'kiosk'}` the expected list is `lab,sessions,gpus` (the page routes metrics to `FULL`, so GPUs is ready). The "same theme" check expects `enabledScreens[0].id === 'lab'` as before.
- Add a restart round trip in pytest (not the browser): `tests/test_server.py`. Start with a device saved as kiosk `["lab","sessions"]` in `state.json`, run `apply_saved_state(load_state())` with `kiosk_capable=True`, and assert the screens are unchanged.
- Run the full matrix:
  - `TABS=2`, `TABS=5` and `TABS=7`, each with `CASES=gpus:FULL,gpus:GPU_HOUSE,gpus:GPU_HOUSE_MANY`;
  - then the default `CASES` with `TABS=2`.

**R10 (Task 5, exact order).**
- Every row gets `data-gpu-row="<host>|<index>"`, with the host escaped.
- The harness computes the expected sorted list itself, from the fixture: state order, then the fixture's `gpu_hosts` order, then index.
- For `GPU_HOUSE` (and a `GPU_HOUSE_TIES` fixture with two hosts and two indices per state for `busy` and `hot`), it asserts:
  - the rendered `data-gpu-row` sequence equals the expected list's first `shown` entries;
  - `shown ≥ 1`;
  - `+N MORE` equals `total − shown` (or is absent when `shown == total`).
- These checks run for both skins at h = 600, 683 and 246.

**R11 (Task 2, baseline validation).** `gpu_memory()` validates each record:
- `rec` is a dict;
- `seen_at` is a finite number;
- `gpus` is a list of at most `MAX_GPUS` dicts;
- each has `index` an int (not a bool) and ≥ 0;
- numeric fields are finite numbers or None;
- `name` and `bus_id` are strings;
- `throttle` and `procs` are ints or None;
- `detail` is a bool.

Any violation drops that host's record. `test_baseline_ignores_bad_gpu_memory` adds `gpus: [null]`,
`seen_at: NaN`, and `{"index": true}`.
