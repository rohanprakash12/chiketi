# Home Lab Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a management-by-exception **Home Lab** health screen to chiketi. It is fed by
read-only remote health probes, rendered in all three Sci-Fi variants with a display frame
that adapts to any aspect ratio, and served from chiketi-server to the kiosk-deploy kiosks.

**Architecture:**
- A new `chiketi/collectors/homelab/` package runs its own background poller thread. Every
  30 s it SSHes to each host's forced-command probe (`chiketi-probe`, POSIX sh), checks the
  gateway, Home Assistant and Atlas's backup API, and turns the results into issues. Those go
  through hold/clear rules and are cached.
- `HomelabCollector.collect()` only reads that cache.
- The frontend gains a `FRAME_H`/`layoutClass()` frame model and three Bridge Station widgets
  (`bsAlertBanner`, `bsHostStrip`, `bsIssueCard`).
- `screen6` is a fluid screen, and the Sci-Fi Clock becomes fluid too.

**Tech stack:**
- Python ≥ 3.11, standard library only (`tomllib`, `subprocess`, `socket`, `urllib`,
  `concurrent.futures`). psutil stays the only runtime dependency.
- ES2017 browser JS with no build step.
- POSIX sh probe.
- Node for the renderer harness. Playwright-core with a local Chromium for the fit check.

**Spec:** `specs/2026-10-20-homelab-screen-design.md`. Read it before starting any task.

## Global Constraints

- psutil is the only runtime dependency, so no new Python packages. `tomllib` is in the
  standard library from 3.11.
- ES2017 in `chiketi/assets/ui/*.js`, with no build step and no modules.
- No breaking changes. A chiketi without `homelab.toml` behaves exactly as today, apart from
  existing screens being letterboxed instead of cropped on screens that aren't 1024×600.
- Layout sizes in screens use `gq()` (cqw). No absolute px over 2 px; the harness enforces this.
- Every remote string reaching HTML goes through `esc()`.
- Remote access is read-only and enforced on the target (`command="…",restrict` in
  `authorized_keys`).
- **Read-only toward Atlas and Vesta.** Never send backup commands or service-control actions.
  Installing the probe there needs the owner's explicit approval in the session (Task 13).
- Back up any deployed file before overwriting it (`*.bak-YYYYMMDD`).
- Do not run `ruff format`; follow the existing style. Run `ruff check .`.
- Do not hand-edit generated `docs/site/*`.
- Supported frame shapes: landscape aspect 1.33–1.78, which is a frame height of 576–770 units
  at 1024 units wide. The test shapes are 1024×576, 1024×600, 1024×640, 1800×1200 and 1024×768.
- Commit after every task on branch `feat/homelab-screen`, with these trailers:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01FoFFf4K4CUrdH6HPDArPdC`.

## Review Focus

1. **A host that stays down must not silently clear its other issues.** A disk at 97 % on a
   host that then becomes unreachable still shows, alongside "Unreachable". This is pinned by
   `test_unreachable_freezes_other_issues` (Task 3).
2. **Remote strings are hostile.** A disk model, failed-unit name or mount path containing
   `<img …>` must be escaped on screen and truncated in Python. This is pinned by
   `test_titles_truncate_remote_strings` (Task 3) and the `HL_HOSTILE` harness fixture (Task 9).
3. **Unraid array disks must not be spun up by the probe.** `smart-read` uses
   `smartctl -n standby`, and a disk in standby is skipped. This is pinned by
   `test_probe_never_wakes_disks` (Task 1).
4. **A changed SSH host key must never be accepted.** It shows as "host key mismatch". This is
   pinned by `test_host_key_mismatch_detail` (Task 4).
5. **SMART baselines survive restarts, and a frozen poller is never shown as healthy.** These
   are pinned by `test_baseline_persists` (Task 3) and the `HL_STALE` harness fixture (Task 9).

---

## File structure

**chiketi (this repo)**

| Path | Responsibility |
|---|---|
| `chiketi/assets/probe/chiketi-probe` | create: read-only health probe, POSIX sh, prints `key=value` |
| `chiketi/assets/probe/smart-read` | create: root helper that runs `smartctl -n standby -H -A /dev/<name>` for one validated name |
| `chiketi/collectors/homelab/__init__.py` | create: exports `HomelabCollector` |
| `chiketi/collectors/homelab/probe.py` | create: `parse_probe()` → `ProbeReport` |
| `chiketi/collectors/homelab/config.py` | create: `load_config()` → `HomelabConfig`, plus default thresholds |
| `chiketi/collectors/homelab/rules.py` | create: `Condition`, `evaluate_report`, `evaluate_backup`, `IssueTracker`, `Baseline` |
| `chiketi/collectors/homelab/checks.py` | create: `run_probe`, `evaluate_gateway`, `evaluate_http`, `fetch_json`, `CheckError` |
| `chiketi/collectors/homelab/poller.py` | create: `HomelabPoller` thread and snapshot |
| `chiketi/collectors/homelab/collector.py` | create: `HomelabCollector(MetricCollector)` |
| `chiketi/collectors/registry.py` | modify: register `HomelabCollector` |
| `chiketi/__main__.py`, `chiketi/app.py` | modify: `--no-kiosk` |
| `chiketi/assets/ui/shared_helpers.js` | modify: `FRAME_H`, `setFrameH`, `layoutClass`, `fluidH` |
| `chiketi/assets/ui/display_app.js` | modify: frame scaling (contain or fluid), registry `fluid` + `screen6` |
| `chiketi/assets/ui/control_app.js` | modify: registry `fluid` + `screen6`, preview aspect |
| `chiketi/assets/ui/display.css`, `control.css` | modify: `.screen-frame.fluid`, `@keyframes hlPulse` |
| `chiketi/assets/ui/screen_functions.js` | modify: `bsFrame(body, fluid)`, fluid Sci-Fi clocks, Home Lab widgets and screen |
| `tests/test_homelab_*.py` | create: unit tests |
| `tests/fixtures/homelab/*.txt` | create: probe output fixtures |
| `tests/js/fixtures.js`, `tests/js/render_harness.js` | modify: homelab fixtures, registry, checks at five shapes |
| `scripts/fit_check.mjs` | create: real-browser overflow check and screenshots at five shapes |

**kiosk-deploy (`/home/user/projects/kiosk-deploy`, not a git repo)**

| Path | Responsibility |
|---|---|
| `chiketi-server/homelab.toml` | the owner's host list (no secrets) |
| `chiketi-server/chiketi.service` | the systemd unit |
| `chiketi-server/deploy.sh` | explicit deploy of a chiketi commit to chiketi-server |
| `chiketi-server/install-probe.sh` | installs the probe, sudoers line and forced-command key on a Linux host |
| `chiketi-server/unraid-probe.md` | exact steps for Atlas and Vesta (run only after approval) |
| `kiosk-1/shell.html` | the Go's fallback page |
| `kiosk-1/chromium-kiosk.sh` | modify: open `shell.html` |

---

### Task 0: Dev environment

**Files:** none (local venv only)

- [ ] **Step 1: Create the venv and check the baseline passes**

```bash
cd ~/projects/chiketi
findmnt -n -o FSTYPE -T .            # must print virtiofs (see kiosk-deploy CLAUDE.md); stop if not
grep -qx '.venv/' .gitignore || grep -q '^\.venv' .gitignore || echo "WARN: .venv not ignored"
python3 -m venv .venv && .venv/bin/pip install -q -e ".[dev]"
.venv/bin/pytest -q && node tests/js/render_harness.js && ./scripts/check_js.sh && .venv/bin/ruff check .
```
Expected: all pass. If `.venv` isn't ignored, add `.venv/` to `.gitignore` and commit
"chore: ignore .venv".

---

### Task 1: The probe scripts

**Files:**
- Create: `chiketi/assets/probe/chiketi-probe`
- Create: `chiketi/assets/probe/smart-read`
- Test: `tests/test_homelab_probe_script.py`

**Interfaces:**
- Produces: the stdout line protocol that Task 2 parses:
  `probe_version=1`, `kind=linux|unraid`, `mem_total_kb=N`, `mem_avail_kb=N`,
  `fs=<mount>|<pct>`, `cpu_temp_c=N`, `gpu_temp_c=N` (repeatable),
  `disk=<dev>|<model>|<temp>|<realloc>|<pending>|<offline_unc>|<health>`,
  `failed_units=<n>|<a,b>`, `sec_updates=N`, `unraid_array=<STATE>`,
  `unraid_disk=<name>|<STATUS>`, `unraid_parity_errors=N`.
- Deviation from the spec, on purpose: `sec_updates` carries only the count. How long updates
  have been pending is tracked on chiketi-server (first seen, in `Baseline`), because the probe
  can't know reliably.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_homelab_probe_script.py
"""The real probe script, run on this machine. Linux only."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys

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
    assert keys["probe_version"] == ["1"]
    assert keys["kind"][0] in ("linux", "unraid")
    assert int(keys["mem_total_kb"][0]) > 0
    assert int(keys["mem_avail_kb"][0]) >= 0
    assert any(v.startswith("/|") for v in keys.get("fs", [])), keys.get("fs")


def test_probe_never_wakes_disks():
    src = open(SMART).read()
    assert "-n standby" in src
    assert "exec smartctl" in src


def test_smart_read_rejects_bad_device_names():
    for bad in ["", "../sda", "sda;id", "sda b", "/dev/sda"]:
        r = subprocess.run(["sh", SMART, bad], capture_output=True, text=True)
        assert r.returncode == 2, bad


@pytest.mark.skipif(shutil.which("shellcheck") is None, reason="shellcheck not installed")
def test_shellcheck_clean():
    subprocess.run(["shellcheck", "-s", "sh", PROBE, SMART], check=True)
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `.venv/bin/pytest tests/test_homelab_probe_script.py -v`
Expected: FAIL / ERROR with `FileNotFoundError` for `chiketi-probe`.

- [ ] **Step 3: Write `smart-read`**

```sh
#!/bin/sh
# smart-read: read-only SMART health and attributes for ONE disk.
# chiketi-probe runs it through `sudo -n` (Linux) or directly (Unraid, root).
# -n standby: never spin a sleeping disk up; smartctl exits with bit 1 set instead.
case "$1" in
  ''|*[!a-z0-9]*) echo "smart-read: bad device name" >&2; exit 2 ;;
esac
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
exec smartctl -n standby -H -A "/dev/$1"
```

- [ ] **Step 4: Write `chiketi-probe`**

```sh
#!/bin/sh
# chiketi-probe: read-only health snapshot for chiketi's Home Lab screen.
#
# It runs as the forced command of chiketi-server's key (authorized_keys
# `command="/usr/local/bin/chiketi-probe",restrict`), so it takes no arguments
# and reads no input. It prints key=value lines and changes nothing; the only
# write is a one-hour cache of the apt security-update count in /tmp.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
LC_ALL=C
export PATH LC_ALL

echo "probe_version=1"
if [ -r /var/local/emhttp/var.ini ]; then KIND=unraid; else KIND=linux; fi
echo "kind=$KIND"

awk '/^MemTotal:/ {print "mem_total_kb=" $2} /^MemAvailable:/ {print "mem_avail_kb=" $2}' /proc/meminfo

# Real local filesystems only: network and virtual mounts (nfs, virtiofs, fuse,
# tmpfs, overlay) belong to some other host or to nobody.
df -P -T -k 2>/dev/null | awk 'NR > 1 && $2 ~ /^(ext[234]|xfs|btrfs|zfs|vfat|f2fs)$/ {
  pct = $6; sub(/%$/, "", pct); m = $7
  for (i = 8; i <= NF; i++) m = m " " $i
  gsub(/[|=]/, "_", m); print "fs=" m "|" pct }'

best=""
for d in /sys/class/hwmon/hwmon*; do
  n=$(cat "$d/name" 2>/dev/null)
  case "$n" in coretemp|k10temp|zenpower|cpu_thermal) ;; *) continue ;; esac
  for t in "$d"/temp*_input; do
    [ -r "$t" ] || continue
    v=$(cat "$t" 2>/dev/null)
    case "$v" in ''|*[!0-9]*) continue ;; esac
    if [ -z "$best" ] || [ "$v" -gt "$best" ]; then best=$v; fi
  done
done
[ -n "$best" ] && echo "cpu_temp_c=$((best / 1000))"

if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>/dev/null |
  while read -r t; do
    case "$t" in ''|*[!0-9]*) ;; *) echo "gpu_temp_c=$t" ;; esac
  done
fi

HELPER=/usr/local/lib/chiketi-probe/smart-read
if command -v smartctl >/dev/null 2>&1 && [ -x "$HELPER" ]; then
  if [ "$(id -u)" = 0 ]; then RUN=""; else RUN="sudo -n"; fi
  for dev in $(lsblk -dno NAME,TYPE 2>/dev/null | awk '$2 == "disk" && $1 !~ /^(loop|zram|sr|ram)/ {print $1}'); do
    out=$($RUN "$HELPER" "$dev" 2>/dev/null)
    rc=$?
    # Bit 1: could not open the device, or it is in standby (-n standby). Skip it.
    [ $((rc & 2)) -ne 0 ] && continue
    model=$(tr -s ' ' < "/sys/block/$dev/device/model" 2>/dev/null | sed 's/^ //;s/ $//' | tr -d '|=')
    printf '%s\n' "$out" | awk -v dev="$dev" -v model="$model" '
      /overall-health self-assessment test result:/ { h = $NF }
      /SMART Health Status:/ { h = $NF }
      $1 == "5"   && $2 ~ /Reallocated_Sector/ { r = $10 }
      $1 == "197" && $2 ~ /Current_Pending/    { p = $10 }
      $1 == "198" && $2 ~ /Offline_Uncorrect/  { o = $10 }
      ($1 == "194" || $1 == "190") && t == "" { t = $10 }
      /^Temperature:/ && t == "" { t = $2 }
      END { print "disk=" dev "|" model "|" t "|" r "|" p "|" o "|" h }'
  done
fi

if command -v systemctl >/dev/null 2>&1; then
  f=$(systemctl --failed --no-legend --plain 2>/dev/null | awk 'NF {print $1}')
  n=$(printf '%s\n' "$f" | grep -c .)
  names=$(printf '%s' "$f" | tr '\n' ',' | tr -d '|=' | cut -c1-300)
  echo "failed_units=$n|$names"
fi

if command -v apt-get >/dev/null 2>&1; then
  c=/tmp/chiketi-probe-sec
  if [ -z "$(find "$c" -mmin -60 2>/dev/null)" ]; then
    { apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep -c '^Inst .*-security'; true; } > "$c.$$" &&
      mv -f "$c.$$" "$c"
  fi
  [ -r "$c" ] && echo "sec_updates=$(cat "$c")"
fi

if [ "$KIND" = unraid ]; then
  awk -F= '
    $1 == "mdState"    { v = $2; gsub(/"/, "", v); print "unraid_array=" v }
    $1 == "sbSyncErrs" { v = $2; gsub(/"/, "", v); print "unraid_parity_errors=" v }' /var/local/emhttp/var.ini
  awk -F= '
    /^\[/ { s = $0; gsub(/[]["]/, "", s) }
    $1 == "status" { v = $2; gsub(/"/, "", v); if (s != "") print "unraid_disk=" s "|" v }' /var/local/emhttp/disks.ini
fi
exit 0
```

Then: `chmod 755 chiketi/assets/probe/chiketi-probe chiketi/assets/probe/smart-read`

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `.venv/bin/pytest tests/test_homelab_probe_script.py -v`
Expected: PASS. The shellcheck test is skipped if shellcheck isn't installed. If so, install it
(`sudo apt-get install -y shellcheck`) and re-run, so that test also passes.

- [ ] **Step 6: Commit**

```bash
git add chiketi/assets/probe tests/test_homelab_probe_script.py
git commit -m "feat(homelab): read-only health probe and SMART helper"
```

---

### Task 2: Probe parser and config loader

**Files:**
- Create: `chiketi/collectors/homelab/__init__.py` (empty for now; it gets the export in Task 5)
- Create: `chiketi/collectors/homelab/probe.py`
- Create: `chiketi/collectors/homelab/config.py`
- Create: `tests/fixtures/homelab/linux_healthy.txt`, `unraid_degraded.txt`
- Test: `tests/test_homelab_probe.py`, `tests/test_homelab_config.py`

**Interfaces:**
- Produces:
  - `probe.Disk(dev: str, model: str = "", temp_c: float | None = None, realloc: int | None = None, pending: int | None = None, offline_unc: int | None = None, health: str = "")`
  - `probe.ProbeReport(version: int, kind: str = "", mem_total_kb: int | None = None, mem_avail_kb: int | None = None, filesystems: dict[str, float], cpu_temp_c: float | None, gpu_temps: list[float], disks: list[Disk], failed_units: list[str], failed_count: int = 0, sec_updates: int | None = None, unraid_array: str | None = None, unraid_disks: dict[str, str], unraid_parity_errors: int | None = None)`
  - `probe.ProbeError(ValueError)`, `probe.parse_probe(text: str) -> ProbeReport`
  - `config.Host(name, kind, address="", user="", port=22, url="", token_file="", backup_api="", dns_name="one.one.one.one", outside_ip="1.1.1.1")`, frozen
  - `config.HomelabConfig(hosts: tuple[Host, ...], poll_seconds: float = 30.0, ssh_key: str = "", known_hosts: str = "", thresholds: dict[str, float])`, frozen
  - `config.DEFAULT_THRESHOLDS: dict[str, float]`, `config.ConfigError(ValueError)`
  - `config.default_path() -> str`, `config.load_config(path: str) -> HomelabConfig`. This
    raises `FileNotFoundError` when the file is missing and `ConfigError` when it is invalid.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/homelab/linux_healthy.txt`:
```
probe_version=1
kind=linux
mem_total_kb=8000000
mem_avail_kb=6000000
fs=/|14
fs=/boot/efi|1
cpu_temp_c=41
disk=sda|Samsung SSD 840 EVO 120GB|31|0|0|0|PASSED
failed_units=0|
sec_updates=0
```

`tests/fixtures/homelab/unraid_degraded.txt`:
```
probe_version=1
kind=unraid
mem_total_kb=32000000
mem_avail_kb=1000000
fs=/boot|40
fs=/mnt/disk1|97
fs=/mnt/cache|50
disk=sdb|WDC WD80EFAX|38|8|2|0|PASSED
disk=sdc|ST8000VN004||||||
unraid_array=STARTED
unraid_disk=parity|DISK_OK
unraid_disk=disk1|DISK_OK
unraid_disk=disk2|DISK_DSBL
unraid_disk=parity2|DISK_NP_DSBL
unraid_parity_errors=3
garbage line without equals
unknown_future_key=whatever
```

- [ ] **Step 2: Write the failing tests**

```python
# tests/test_homelab_probe.py
from __future__ import annotations

import os

import pytest

from chiketi.collectors.homelab.probe import ProbeError, parse_probe

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "homelab")


def read(name: str) -> str:
    with open(os.path.join(FIX, name)) as f:
        return f.read()


def test_linux_healthy():
    r = parse_probe(read("linux_healthy.txt"))
    assert r.version == 1 and r.kind == "linux"
    assert r.mem_total_kb == 8000000 and r.mem_avail_kb == 6000000
    assert r.filesystems == {"/": 14.0, "/boot/efi": 1.0}
    assert r.cpu_temp_c == 41.0
    (d,) = r.disks
    assert (d.dev, d.model, d.temp_c, d.realloc, d.pending, d.offline_unc, d.health) == \
        ("sda", "Samsung SSD 840 EVO 120GB", 31.0, 0, 0, 0, "PASSED")
    assert r.failed_count == 0 and r.failed_units == []
    assert r.sec_updates == 0


def test_unraid_degraded():
    r = parse_probe(read("unraid_degraded.txt"))
    assert r.kind == "unraid"
    assert r.unraid_array == "STARTED"
    assert r.unraid_disks["disk2"] == "DISK_DSBL"
    assert r.unraid_parity_errors == 3
    blank = [d for d in r.disks if d.dev == "sdc"][0]
    assert blank.temp_c is None and blank.realloc is None and blank.health == ""


def test_failed_units_list():
    r = parse_probe("probe_version=1\nfailed_units=2|a.service,b.service,\n")
    assert r.failed_count == 2 and r.failed_units == ["a.service", "b.service"]


def test_gpu_temps_repeat():
    r = parse_probe("probe_version=1\ngpu_temp_c=60\ngpu_temp_c=71\n")
    assert r.gpu_temps == [60.0, 71.0]


@pytest.mark.parametrize("text", ["", "hello", "kind=linux\n", "probe_version=abc\n", "probe_version=0\n"])
def test_rejects_non_probe_output(text):
    with pytest.raises(ProbeError):
        parse_probe(text)


def test_bad_numbers_become_none():
    r = parse_probe("probe_version=1\nmem_total_kb=lots\nfs=/|n/a\n")
    assert r.mem_total_kb is None
    assert r.filesystems == {}


def test_line_cap():
    text = "probe_version=1\n" + "fs=/x|1\n" * 10000
    assert parse_probe(text).version == 1
```

```python
# tests/test_homelab_config.py
from __future__ import annotations

import pytest

from chiketi.collectors.homelab.config import (
    DEFAULT_THRESHOLDS, ConfigError, default_path, load_config,
)

GOOD = """
poll_seconds = 30
ssh_key = "~/.ssh/chiketi_homelab"

[thresholds]
fs_warn_pct = 80

[[host]]
name = "Atlas"
kind = "unraid"
address = "192.0.2.212"
user = "root"
backup_api = "http://192.0.2.212:8765/api/status"

[[host]]
name = "pfSense"
kind = "gateway"
address = "192.0.2.1"

[[host]]
name = "Home Assistant"
kind = "http"
url = "http://192.0.2.30:8123/api/"
token_file = "~/.config/chiketi/ha_token"
"""


def write(tmp_path, text):
    p = tmp_path / "homelab.toml"
    p.write_text(text)
    return str(p)


def test_good(tmp_path):
    cfg = load_config(write(tmp_path, GOOD))
    assert [h.name for h in cfg.hosts] == ["Atlas", "pfSense", "Home Assistant"]
    assert cfg.hosts[0].user == "root" and cfg.hosts[0].port == 22
    assert cfg.thresholds["fs_warn_pct"] == 80
    assert cfg.thresholds["fs_crit_pct"] == DEFAULT_THRESHOLDS["fs_crit_pct"]
    assert not cfg.ssh_key.startswith("~")
    assert cfg.known_hosts.endswith("homelab_known_hosts")


def test_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_config(str(tmp_path / "nope.toml"))


@pytest.mark.parametrize("bad", [
    "not toml [",
    "poll_seconds = 1\n[[host]]\nname='a'\nkind='gateway'\naddress='1.1.1.1'",
    "[[host]]\nname='a'\nkind='spaceship'\naddress='x'",
    "[[host]]\nname='a'\nkind='linux'",
    "[[host]]\nname='a'\nkind='http'\nurl='ftp://x'",
    "[[host]]\nname='a'\nkind='gateway'\naddress='x'\n[[host]]\nname='a'\nkind='gateway'\naddress='y'",
    "[thresholds]\nmystery = 3\n[[host]]\nname='a'\nkind='gateway'\naddress='x'",
    "[thresholds]\nfs_warn_pct = 'high'\n[[host]]\nname='a'\nkind='gateway'\naddress='x'",
    "hosts = []",
])
def test_invalid(tmp_path, bad):
    with pytest.raises(ConfigError):
        load_config(write(tmp_path, bad))


def test_default_path_uses_xdg(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    assert default_path() == str(tmp_path / "chiketi" / "homelab.toml")
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `.venv/bin/pytest tests/test_homelab_probe.py tests/test_homelab_config.py -v`
Expected: FAIL with `ModuleNotFoundError: chiketi.collectors.homelab`.

- [ ] **Step 4: Implement `probe.py`**

```python
"""Parse chiketi-probe's key=value output. Unknown keys are ignored."""

from __future__ import annotations

from dataclasses import dataclass, field

MAX_LINES = 2000


class ProbeError(ValueError):
    """The text is not chiketi-probe output."""


@dataclass
class Disk:
    dev: str
    model: str = ""
    temp_c: float | None = None
    realloc: int | None = None
    pending: int | None = None
    offline_unc: int | None = None
    health: str = ""


@dataclass
class ProbeReport:
    version: int
    kind: str = ""
    mem_total_kb: int | None = None
    mem_avail_kb: int | None = None
    filesystems: dict[str, float] = field(default_factory=dict)
    cpu_temp_c: float | None = None
    gpu_temps: list[float] = field(default_factory=list)
    disks: list[Disk] = field(default_factory=list)
    failed_units: list[str] = field(default_factory=list)
    failed_count: int = 0
    sec_updates: int | None = None
    unraid_array: str | None = None
    unraid_disks: dict[str, str] = field(default_factory=dict)
    unraid_parity_errors: int | None = None


def _int(s: str) -> int | None:
    try:
        return int(s.strip())
    except ValueError:
        return None


def _float(s: str) -> float | None:
    try:
        return float(s.strip())
    except ValueError:
        return None


def parse_probe(text: str) -> ProbeReport:
    pairs = []
    for line in text.splitlines()[:MAX_LINES]:
        k, sep, v = line.partition("=")
        if sep:
            pairs.append((k.strip(), v))
    version = next((_int(v) for k, v in pairs if k == "probe_version"), None)
    if not version or version < 1:
        raise ProbeError("no probe_version line")
    r = ProbeReport(version=version)
    for k, v in pairs:
        if k == "kind":
            r.kind = v.strip()
        elif k == "mem_total_kb":
            r.mem_total_kb = _int(v)
        elif k == "mem_avail_kb":
            r.mem_avail_kb = _int(v)
        elif k == "fs":
            mount, _, pct = v.rpartition("|")
            p = _float(pct)
            if mount and p is not None:
                r.filesystems[mount] = p
        elif k == "cpu_temp_c":
            r.cpu_temp_c = _float(v)
        elif k == "gpu_temp_c":
            t = _float(v)
            if t is not None:
                r.gpu_temps.append(t)
        elif k == "disk":
            f = (v.split("|") + [""] * 7)[:7]
            if f[0]:
                r.disks.append(Disk(dev=f[0], model=f[1], temp_c=_float(f[2]) if f[2] else None,
                                    realloc=_int(f[3]) if f[3] else None,
                                    pending=_int(f[4]) if f[4] else None,
                                    offline_unc=_int(f[5]) if f[5] else None,
                                    health=f[6].strip()))
        elif k == "failed_units":
            n, _, names = v.partition("|")
            r.failed_count = _int(n) or 0
            r.failed_units = [x for x in names.split(",") if x]
        elif k == "sec_updates":
            r.sec_updates = _int(v)
        elif k == "unraid_array":
            r.unraid_array = v.strip()
        elif k == "unraid_disk":
            name, _, status = v.partition("|")
            if name:
                r.unraid_disks[name] = status.strip()
        elif k == "unraid_parity_errors":
            r.unraid_parity_errors = _int(v)
    return r
```

- [ ] **Step 5: Implement `config.py`**

```python
"""homelab.toml: which hosts the Home Lab screen watches, and its thresholds."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field

KINDS = ("linux", "unraid", "gateway", "http")

DEFAULT_THRESHOLDS: dict[str, float] = {
    "fs_warn_pct": 85.0, "fs_crit_pct": 95.0,
    "mem_warn_pct": 10.0, "mem_crit_pct": 5.0,      # memory AVAILABLE below this
    "cpu_warn_c": 85.0, "cpu_crit_c": 95.0,
    "disk_warn_c": 50.0, "disk_crit_c": 60.0,
    "gpu_warn_c": 85.0, "gpu_crit_c": 92.0,
    "sec_updates_days": 14.0,
    "backup_max_age_h": 0.0,                        # 0 = backup age not checked
}


class ConfigError(ValueError):
    """homelab.toml exists but is not usable."""


@dataclass(frozen=True)
class Host:
    name: str
    kind: str
    address: str = ""
    user: str = ""
    port: int = 22
    url: str = ""
    token_file: str = ""
    backup_api: str = ""
    dns_name: str = "one.one.one.one"
    outside_ip: str = "1.1.1.1"


@dataclass(frozen=True)
class HomelabConfig:
    hosts: tuple[Host, ...]
    poll_seconds: float = 30.0
    ssh_key: str = ""
    known_hosts: str = ""
    thresholds: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_THRESHOLDS))


def _config_dir() -> str:
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "chiketi")


def default_path() -> str:
    return os.path.join(_config_dir(), "homelab.toml")


def _str(d: dict, key: str, where: str, default: str = "") -> str:
    v = d.get(key, default)
    if not isinstance(v, str):
        raise ConfigError(f"{where}: {key} must be a string")
    return v


def load_config(path: str) -> HomelabConfig:
    try:
        with open(path, "rb") as f:
            raw = tomllib.load(f)
    except FileNotFoundError:
        raise
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ConfigError(f"{path}: {exc}") from exc

    poll = raw.get("poll_seconds", 30)
    if not isinstance(poll, (int, float)) or not 10 <= poll <= 600:
        raise ConfigError("poll_seconds must be a number from 10 to 600")

    thresholds = dict(DEFAULT_THRESHOLDS)
    for k, v in (raw.get("thresholds") or {}).items():
        if k not in DEFAULT_THRESHOLDS:
            raise ConfigError(f"unknown threshold {k!r}")
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise ConfigError(f"threshold {k} must be a number")
        thresholds[k] = float(v)

    rows = raw.get("host")
    if not isinstance(rows, list) or not rows or len(rows) > 32:
        raise ConfigError("need 1-32 [[host]] tables")
    hosts: list[Host] = []
    seen: set[str] = set()
    for i, row in enumerate(rows):
        where = f"host #{i + 1}"
        if not isinstance(row, dict):
            raise ConfigError(f"{where}: must be a table")
        name = _str(row, "name", where).strip()
        if not 1 <= len(name) <= 32 or name in seen:
            raise ConfigError(f"{where}: name must be 1-32 chars and unique")
        seen.add(name)
        kind = _str(row, "kind", where)
        if kind not in KINDS:
            raise ConfigError(f"{where}: kind must be one of {', '.join(KINDS)}")
        port = row.get("port", 22)
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise ConfigError(f"{where}: port must be 1-65535")
        h = Host(
            name=name, kind=kind, address=_str(row, "address", where),
            user=_str(row, "user", where), port=port, url=_str(row, "url", where),
            token_file=os.path.expanduser(_str(row, "token_file", where)),
            backup_api=_str(row, "backup_api", where),
            dns_name=_str(row, "dns_name", where, "one.one.one.one"),
            outside_ip=_str(row, "outside_ip", where, "1.1.1.1"),
        )
        if kind in ("linux", "unraid", "gateway") and not h.address:
            raise ConfigError(f"{where}: {kind} hosts need an address")
        if kind in ("linux", "unraid") and not h.user:
            raise ConfigError(f"{where}: {kind} hosts need a user")
        if kind == "http" and not h.url.startswith(("http://", "https://")):
            raise ConfigError(f"{where}: http hosts need an http(s) url")
        if h.backup_api and not h.backup_api.startswith(("http://", "https://")):
            raise ConfigError(f"{where}: backup_api must be an http(s) url")
        hosts.append(h)

    return HomelabConfig(
        hosts=tuple(hosts), poll_seconds=float(poll),
        ssh_key=os.path.expanduser(_str(raw, "ssh_key", "top level", "~/.ssh/chiketi_homelab")),
        known_hosts=os.path.join(_config_dir(), "homelab_known_hosts"),
        thresholds=thresholds,
    )
```

Note: `test_invalid`'s case 4 (`kind='linux'` without an address) fails on the address check.

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `.venv/bin/pytest tests/test_homelab_probe.py tests/test_homelab_config.py -v && .venv/bin/ruff check .`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add chiketi/collectors/homelab tests/test_homelab_probe.py tests/test_homelab_config.py tests/fixtures/homelab
git commit -m "feat(homelab): probe parser and homelab.toml loader"
```

---

### Task 3: Rules, issue tracking and baselines

**Files:**
- Create: `chiketi/collectors/homelab/rules.py`
- Test: `tests/test_homelab_rules.py`

**Interfaces:**
- Consumes: `ProbeReport` and `Disk` (Task 2), `DEFAULT_THRESHOLDS` (Task 2).
- Produces:
  - `Condition(key: str, severity: "warn" | "crit", title: str, detail: str, hold: int)`, frozen
  - Hold constants: `HOLD_NOW = 1`, `HOLD_FS = 2`, `HOLD_UNITS = 2`, `HOLD_TEMP = 4`,
    `HOLD_DOWN = 4`, `HOLD_MEM = 10`
  - `down(detail: str) -> Condition`, with key `"down"`
  - `Baseline(path: str)` with these methods:
    - `.smart_rises(host: str, disk: Disk) -> list[tuple[str, int, int]]`
    - `.sec_pending_since(host: str, count: int | None, now: float) -> float | None`
    - `.save() -> None`
  - `evaluate_report(host: str, rep: ProbeReport, thr: dict, baseline: Baseline, now: float) -> list[Condition]`
  - `evaluate_backup(data: dict, thr: dict, now: float) -> list[Condition]`
  - `IssueTracker()` with these methods:
    - `.update(host: str, conds: list[Condition], now: float, partial: bool = False)`
    - `.issues() -> list[dict]`. Each dict is `{host, severity, title, detail, since}`, sorted
      crit before warn, then by `since`.
    - `.host_state(host: str) -> "ok" | "warn" | "crit"`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_homelab_rules.py
from __future__ import annotations

from chiketi.collectors.homelab.config import DEFAULT_THRESHOLDS as THR
from chiketi.collectors.homelab.probe import Disk, ProbeReport
from chiketi.collectors.homelab.rules import (
    HOLD_DOWN, Baseline, Condition, IssueTracker, down, evaluate_backup, evaluate_report,
)


def rep(**kw) -> ProbeReport:
    base = dict(version=1, kind="linux", mem_total_kb=1000, mem_avail_kb=800)
    base.update(kw)
    return ProbeReport(**base)


def keys(conds):
    return {c.key: c.severity for c in conds}


def test_healthy_is_silent(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    assert evaluate_report("h", rep(filesystems={"/": 40.0}, cpu_temp_c=50.0), THR, b, 0) == []


def test_filesystem_thresholds(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    c = evaluate_report("h", rep(filesystems={"/a": 85.0, "/b": 95.0, "/c": 84.9}), THR, b, 0)
    assert keys(c) == {"fs:/a": "warn", "fs:/b": "crit"}


def test_memory_uses_available(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    assert keys(evaluate_report("h", rep(mem_avail_kb=90), THR, b, 0)) == {"mem": "warn"}
    assert keys(evaluate_report("h", rep(mem_avail_kb=40), THR, b, 0)) == {"mem": "crit"}


def test_temperatures(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    c = evaluate_report("h", rep(cpu_temp_c=96.0, gpu_temps=[86.0],
                                 disks=[Disk("sda", temp_c=55.0, health="PASSED")]), THR, b, 0)
    assert keys(c) == {"cpu_temp": "crit", "gpu_temp:0": "warn", "disk_temp:sda": "warn"}


def test_smart_failed_and_rises(tmp_path):
    path = str(tmp_path / "b.json")
    b = Baseline(path)
    first = Disk("sdb", "WD", realloc=8, pending=0, health="PASSED")
    assert evaluate_report("h", rep(disks=[first]), THR, b, 0) == []   # old count = baseline, silent
    worse = Disk("sdb", "WD", realloc=10, pending=0, health="PASSED")
    assert keys(evaluate_report("h", rep(disks=[worse]), THR, b, 1)) == {"smart:sdb": "warn"}
    failed = Disk("sdb", "WD", realloc=10, pending=0, health="FAILED!")
    assert keys(evaluate_report("h", rep(disks=[failed]), THR, b, 2))["smart:sdb"] == "crit"


def test_baseline_persists(tmp_path):
    path = str(tmp_path / "b.json")
    b = Baseline(path)
    b.smart_rises("h", Disk("sdb", "WD", realloc=8))
    b.save()
    b2 = Baseline(path)
    assert b2.smart_rises("h", Disk("sdb", "WD", realloc=9)) == [("realloc", 8, 9)]


def test_corrupt_baseline_starts_fresh(tmp_path):
    p = tmp_path / "b.json"
    p.write_text("{nope")
    assert Baseline(str(p)).smart_rises("h", Disk("sda", realloc=1)) == []


def test_failed_units_and_updates(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    day = 86400
    r = rep(failed_count=2, failed_units=["a.service", "b.service"], sec_updates=3)
    assert keys(evaluate_report("h", r, THR, b, 0)) == {"units": "warn"}
    assert keys(evaluate_report("h", r, THR, b, 15 * day)) == {"units": "warn", "sec_updates": "warn"}
    # updates applied: the clock resets
    assert "sec_updates" not in keys(evaluate_report("h", rep(sec_updates=0), THR, b, 16 * day))
    assert "sec_updates" not in keys(evaluate_report("h", rep(sec_updates=2), THR, b, 17 * day))


def test_unraid(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    r = rep(kind="unraid", unraid_array="STOPPED", unraid_parity_errors=3,
            unraid_disks={"parity": "DISK_OK", "disk2": "DISK_DSBL", "parity2": "DISK_NP_DSBL"})
    assert keys(evaluate_report("Atlas", r, THR, b, 0)) == {
        "unraid_array": "crit", "unraid_disk:disk2": "crit", "unraid_parity": "warn"}


def test_titles_truncate_remote_strings(tmp_path):
    b = Baseline(str(tmp_path / "b.json"))
    long = "/mnt/" + "x" * 200 + "<img src=x>"
    (c,) = evaluate_report("h", rep(filesystems={long: 99.0}), THR, b, 0)
    assert len(c.title) <= 60
    (u,) = evaluate_report("h", rep(failed_count=1, failed_units=["<b>" * 100]), THR, b, 0)
    assert len(u.detail) <= 120


def test_backup_rules():
    assert evaluate_backup({"active": False, "exit": 0, "errors": []}, THR, 0) == []
    assert keys(evaluate_backup({"active": False, "exit": 23, "errors": []}, THR, 0)) == {"backup_failed": "crit"}
    assert evaluate_backup({"active": True, "exit": 23, "errors": []}, THR, 0) == []
    thr = dict(THR, backup_max_age_h=26)
    events = "2026-10-19T11:45:57-04:00 EXIT 0\n"
    from datetime import datetime
    fin = datetime.fromisoformat("2026-10-19T11:45:57-04:00").timestamp()
    data = {"active": False, "exit": 0, "errors": [], "events": events}
    assert evaluate_backup(data, thr, fin + 25 * 3600) == []
    assert keys(evaluate_backup(data, thr, fin + 27 * 3600)) == {"backup_age": "warn"}


def test_tracker_hold_and_clear():
    t = IssueTracker()
    c = Condition("fs:/", "warn", "/ 90% full", "", 2)
    t.update("h", [c], 100)
    assert t.issues() == []                       # held
    t.update("h", [c], 130)
    (i,) = t.issues()
    assert i == {"host": "h", "severity": "warn", "title": "/ 90% full", "detail": "", "since": 100}
    t.update("h", [], 160)
    assert len(t.issues()) == 1                   # one good check is not enough
    t.update("h", [], 190)
    assert t.issues() == []


def test_blip_never_shows():
    t = IssueTracker()
    t.update("h", [Condition("mem", "crit", "m", "", 10)], 0)
    t.update("h", [], 30)
    t.update("h", [Condition("mem", "crit", "m", "", 10)], 60)
    assert t.issues() == []


def test_unreachable_freezes_other_issues():
    t = IssueTracker()
    fs = Condition("fs:/", "crit", "/ 97% full", "", 1)
    t.update("h", [fs], 0)
    for n in range(1, HOLD_DOWN + 1):
        t.update("h", [down("timed out")], n * 30, partial=True)
    titles = {i["title"] for i in t.issues()}
    assert titles == {"/ 97% full", "Unreachable"}
    assert t.host_state("h") == "crit"


def test_sorting_and_state():
    t = IssueTracker()
    t.update("a", [Condition("x", "warn", "w", "", 1)], 10)
    t.update("b", [Condition("y", "crit", "c", "", 1)], 20)
    assert [i["severity"] for i in t.issues()] == ["crit", "warn"]
    assert t.host_state("a") == "warn" and t.host_state("zzz") == "ok"
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `.venv/bin/pytest tests/test_homelab_rules.py -v`
Expected: FAIL with `ModuleNotFoundError: chiketi.collectors.homelab.rules`.

- [ ] **Step 3: Implement `rules.py`**

```python
"""Turn probe reports into issues: thresholds, hold/clear, and baselines."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime

from chiketi.collectors.homelab.probe import Disk, ProbeReport

HOLD_NOW, HOLD_FS, HOLD_UNITS, HOLD_TEMP, HOLD_DOWN, HOLD_MEM = 1, 2, 2, 4, 4, 10
CLEAR_AFTER = 2
UNRAID_OK = {"DISK_OK", "DISK_NP", "DISK_NP_DSBL"}   # NP = empty slot, normal


@dataclass(frozen=True)
class Condition:
    key: str
    severity: str
    title: str
    detail: str
    hold: int


def _cut(s: str, n: int) -> str:
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def down(detail: str) -> Condition:
    return Condition("down", "crit", "Unreachable", _cut(detail, 120), HOLD_DOWN)


def _level(value: float, warn: float, crit: float, below: bool = False) -> str | None:
    if below:
        return "crit" if value < crit else "warn" if value < warn else None
    return "crit" if value >= crit else "warn" if value >= warn else None


class Baseline:
    """SMART counters seen first, and when security updates first appeared.

    Old non-zero SMART counts are common and harmless; only a RISE matters.
    Persisted so a chiketi-server restart does not forget what was normal."""

    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._dirty = False
        self._data: dict = {"smart": {}, "sec": {}}
        try:
            with open(path) as f:
                raw = json.load(f)
            if isinstance(raw.get("smart"), dict) and isinstance(raw.get("sec"), dict):
                self._data = raw
        except (OSError, ValueError, AttributeError):
            pass

    def smart_rises(self, host: str, disk: Disk) -> list[tuple[str, int, int]]:
        key = f"{host}|{disk.dev}|{disk.model}"
        rose = []
        with self._lock:
            base = self._data["smart"].setdefault(key, {})
            for name in ("realloc", "pending", "offline_unc"):
                v = getattr(disk, name)
                if v is None:
                    continue
                if name not in base:
                    base[name] = v
                    self._dirty = True
                elif v > base[name]:
                    rose.append((name, base[name], v))
        return rose

    def sec_pending_since(self, host: str, count: int | None, now: float) -> float | None:
        with self._lock:
            if not count:
                if self._data["sec"].pop(host, None) is not None:
                    self._dirty = True
                return None
            if host not in self._data["sec"]:
                self._data["sec"][host] = now
                self._dirty = True
            return float(self._data["sec"][host])

    def save(self) -> None:
        with self._lock:
            if not self._dirty:
                return
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path) or ".", suffix=".tmp")
            with os.fdopen(fd, "w") as f:
                json.dump(self._data, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
            self._dirty = False


_SMART_NAMES = {"realloc": "reallocated", "pending": "pending", "offline_unc": "uncorrectable"}


def evaluate_report(host: str, rep: ProbeReport, thr: dict, baseline: Baseline,
                    now: float) -> list[Condition]:
    out: list[Condition] = []
    for mount, pct in rep.filesystems.items():
        sev = _level(pct, thr["fs_warn_pct"], thr["fs_crit_pct"])
        if sev:
            out.append(Condition(f"fs:{_cut(mount, 80)}", sev, f"{_cut(mount, 40)} {pct:.0f}% full",
                                 "filesystem space", HOLD_FS))
    if rep.mem_total_kb and rep.mem_avail_kb is not None:
        avail = 100.0 * rep.mem_avail_kb / rep.mem_total_kb
        sev = _level(avail, thr["mem_warn_pct"], thr["mem_crit_pct"], below=True)
        if sev:
            out.append(Condition("mem", sev, f"Memory {avail:.0f}% available",
                                 f"{rep.mem_avail_kb // 1024} MiB free of {rep.mem_total_kb // 1024} MiB",
                                 HOLD_MEM))
    if rep.cpu_temp_c is not None:
        sev = _level(rep.cpu_temp_c, thr["cpu_warn_c"], thr["cpu_crit_c"])
        if sev:
            out.append(Condition("cpu_temp", sev, f"CPU {rep.cpu_temp_c:.0f}°C", "package temperature", HOLD_TEMP))
    for i, t in enumerate(rep.gpu_temps):
        sev = _level(t, thr["gpu_warn_c"], thr["gpu_crit_c"])
        if sev:
            out.append(Condition(f"gpu_temp:{i}", sev, f"GPU {i} {t:.0f}°C", "", HOLD_TEMP))
    for d in rep.disks:
        dev = _cut(d.dev, 16)
        if d.health and d.health.upper().rstrip("!") not in ("PASSED", "OK"):
            out.append(Condition(f"smart:{dev}", "crit", f"Disk {dev} SMART {_cut(d.health, 12)}",
                                 _cut(d.model, 60), HOLD_NOW))
        else:
            rises = baseline.smart_rises(host, d)
            if rises:
                what = ", ".join(f"{_SMART_NAMES[n]} {a}→{b}" for n, a, b in rises)
                out.append(Condition(f"smart:{dev}", "warn", f"Disk {dev}: {what}", _cut(d.model, 60), HOLD_NOW))
        if d.temp_c is not None:
            sev = _level(d.temp_c, thr["disk_warn_c"], thr["disk_crit_c"])
            if sev:
                out.append(Condition(f"disk_temp:{dev}", sev, f"Disk {dev} {d.temp_c:.0f}°C",
                                     _cut(d.model, 60), HOLD_TEMP))
    if rep.failed_count > 0:
        n = rep.failed_count
        out.append(Condition("units", "warn", f"{n} failed service{'s' if n != 1 else ''}",
                             _cut(", ".join(rep.failed_units[:3]), 120), HOLD_UNITS))
    since = baseline.sec_pending_since(host, rep.sec_updates, now)
    if since is not None and now - since >= thr["sec_updates_days"] * 86400:
        days = int((now - since) // 86400)
        out.append(Condition("sec_updates", "warn", f"{rep.sec_updates} security updates pending",
                             f"for {days} days", HOLD_NOW))
    if rep.kind == "unraid":
        if rep.unraid_array and rep.unraid_array.upper() != "STARTED":
            out.append(Condition("unraid_array", "crit", f"Array {_cut(rep.unraid_array, 16).lower()}", "", HOLD_NOW))
        for name, status in rep.unraid_disks.items():
            if status and status not in UNRAID_OK:
                out.append(Condition(f"unraid_disk:{_cut(name, 16)}", "crit",
                                     f"{_cut(name, 16)} {_cut(status, 20)}", "Unraid disk status", HOLD_NOW))
        if rep.unraid_parity_errors:
            out.append(Condition("unraid_parity", "warn", f"Parity check: {rep.unraid_parity_errors} errors",
                                 "last parity check", HOLD_NOW))
    return out


def _last_exit(events: object) -> float | None:
    for line in reversed(str(events or "").splitlines()):
        if " EXIT " in line:
            try:
                return datetime.fromisoformat(line.split()[0]).timestamp()
            except ValueError:
                return None
    return None


def evaluate_backup(data: dict, thr: dict, now: float) -> list[Condition]:
    out: list[Condition] = []
    if data.get("active"):
        return out
    code = data.get("exit")
    if isinstance(code, int) and not isinstance(code, bool) and code != 0:
        out.append(Condition("backup_failed", "crit", "Backup failed", f"exit code {code}", HOLD_NOW))
    max_h = thr.get("backup_max_age_h", 0.0)
    if max_h > 0:
        fin = _last_exit(data.get("events"))
        if fin is None or now - fin > max_h * 3600:
            ago = "never" if fin is None else f"{int((now - fin) // 3600)} h ago"
            out.append(Condition("backup_age", "warn", "Backup overdue", f"last finished {ago}", HOLD_NOW))
    return out


@dataclass
class _Track:
    cond: Condition
    since: float
    bad: int = 0
    good: int = 0
    raised: bool = False


class IssueTracker:
    """Raise a condition only after `hold` bad checks in a row; clear it after
    CLEAR_AFTER good ones. partial=True (host unreachable) leaves every key the
    update does not mention exactly as it was."""

    def __init__(self) -> None:
        self._t: dict[tuple[str, str], _Track] = {}

    def update(self, host: str, conds: list[Condition], now: float, partial: bool = False) -> None:
        seen = set()
        for c in conds:
            k = (host, c.key)
            seen.add(k)
            t = self._t.get(k)
            if t is None:
                t = self._t[k] = _Track(cond=c, since=now)
            t.cond, t.bad, t.good = c, t.bad + 1, 0
            if t.bad >= c.hold:
                t.raised = True
        if partial:
            return
        for k in [k for k in self._t if k[0] == host and k not in seen]:
            t = self._t[k]
            t.good, t.bad = t.good + 1, 0
            if not t.raised or t.good >= CLEAR_AFTER:
                del self._t[k]

    def issues(self) -> list[dict]:
        out = [{"host": h, "severity": t.cond.severity, "title": t.cond.title,
                "detail": t.cond.detail, "since": t.since}
               for (h, _k), t in self._t.items() if t.raised]
        out.sort(key=lambda i: (0 if i["severity"] == "crit" else 1, i["since"]))
        return out

    def host_state(self, host: str) -> str:
        sev = {t.cond.severity for (h, _k), t in self._t.items() if h == host and t.raised}
        return "crit" if "crit" in sev else "warn" if "warn" in sev else "ok"
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `.venv/bin/pytest tests/test_homelab_rules.py -v && .venv/bin/ruff check .`
Expected: PASS. In `test_tracker_hold_and_clear`, `since` is 100: the time of the first bad
observation, not the time the issue was raised.

- [ ] **Step 5: Commit**

```bash
git add chiketi/collectors/homelab/rules.py tests/test_homelab_rules.py
git commit -m "feat(homelab): threshold rules, hold/clear tracking, SMART baselines"
```

---

### Task 4: Checks (SSH probe, gateway, HTTP, backup fetch)

**Files:**
- Create: `chiketi/collectors/homelab/checks.py`
- Test: `tests/test_homelab_checks.py`

**Interfaces:**
- Consumes: `Host` and `HomelabConfig` (Task 2), `parse_probe`/`ProbeError` (Task 2),
  `Condition`/`down`/`HOLD_DOWN` (Task 3).
- Produces:
  - `CheckError(Exception)`. Its `str()` is a short reason used as the issue detail.
  - `run_probe(host: Host, cfg: HomelabConfig, runner=subprocess.run, timeout: float = 20.0) -> ProbeReport`.
    It raises `CheckError`.
  - `evaluate_gateway(host: Host, connect=socket.create_connection, resolve=socket.getaddrinfo) -> list[Condition]`
  - `evaluate_http(host: Host, opener=urllib.request.urlopen) -> list[Condition]`
  - `fetch_json(url: str, opener=urllib.request.urlopen, timeout: float = 5.0) -> dict`.
    It raises `CheckError`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_homelab_checks.py
from __future__ import annotations

import io
import socket
import subprocess
import urllib.error
from types import SimpleNamespace

import pytest

from chiketi.collectors.homelab.checks import (
    CheckError, evaluate_gateway, evaluate_http, fetch_json, run_probe,
)
from chiketi.collectors.homelab.config import HomelabConfig, Host

CFG = HomelabConfig(hosts=(), ssh_key="/k", known_hosts="/kh")
LINUX = Host("devbox", "linux", address="192.0.2.159", user="user")


def runner_returning(rc=0, out="probe_version=1\nkind=linux\n", err=""):
    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        return SimpleNamespace(returncode=rc, stdout=out, stderr=err)
    run.calls = calls
    return run


def test_run_probe_builds_strict_ssh_command():
    run = runner_returning()
    rep = run_probe(LINUX, CFG, runner=run)
    assert rep.kind == "linux"
    cmd = run.calls[0]
    assert cmd[0] == "ssh" and "user@192.0.2.159" in cmd
    joined = " ".join(cmd)
    for opt in ("BatchMode=yes", "StrictHostKeyChecking=yes", "UserKnownHostsFile=/kh", "ConnectTimeout=5"):
        assert opt in joined
    assert cmd[-1] == "chiketi-probe"


def test_host_key_mismatch_detail():
    run = runner_returning(rc=255, out="", err="Host key verification failed.\n")
    with pytest.raises(CheckError, match="host key mismatch"):
        run_probe(LINUX, CFG, runner=run)


def test_key_refused_detail():
    run = runner_returning(rc=255, out="", err="user@x: Permission denied (publickey).")
    with pytest.raises(CheckError, match="key refused"):
        run_probe(LINUX, CFG, runner=run)


def test_timeout():
    def run(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 20)
    with pytest.raises(CheckError, match="timed out"):
        run_probe(LINUX, CFG, runner=run)


def test_garbage_output_is_a_check_error():
    with pytest.raises(CheckError, match="unreadable"):
        run_probe(LINUX, CFG, runner=runner_returning(out="Welcome to Ubuntu!\n"))


GW = Host("pfSense", "gateway", address="192.0.2.1")


def fake_connect(reachable):
    def connect(addr, timeout=None):
        if addr[0] in reachable:
            return SimpleNamespace(close=lambda: None)
        raise OSError("no route")
    return connect


def test_gateway_all_good():
    assert evaluate_gateway(GW, connect=fake_connect({"192.0.2.1", "1.1.1.1"}),
                            resolve=lambda *a, **k: [object()]) == []


def test_gateway_down_hides_wan_checks():
    (c,) = evaluate_gateway(GW, connect=fake_connect(set()), resolve=lambda *a, **k: [])
    assert c.key == "gw" and c.severity == "crit"


def test_wan_and_dns_down():
    def no_dns(*a, **k):
        raise socket.gaierror("fail")
    conds = evaluate_gateway(GW, connect=fake_connect({"192.0.2.1"}), resolve=no_dns)
    assert {c.key for c in conds} == {"wan", "dns"}


HA = Host("Home Assistant", "http", url="http://192.0.2.30:8123/api/")


def test_http_ok_and_401():
    class Resp(io.BytesIO):
        status = 200
    assert evaluate_http(HA, opener=lambda req, timeout=None: Resp(b"{}")) == []

    def unauthorized(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)
    (c,) = evaluate_http(HA, opener=unauthorized)
    assert c.key == "down" and "401" in c.title


def test_http_unreachable():
    def refused(req, timeout=None):
        raise urllib.error.URLError("connection refused")
    (c,) = evaluate_http(HA, opener=refused)
    assert c.key == "down" and c.title == "Unreachable"


def test_fetch_json():
    class Resp(io.BytesIO):
        status = 200
    assert fetch_json("http://x/", opener=lambda req, timeout=None: Resp(b'{"a": 1}')) == {"a": 1}
    with pytest.raises(CheckError):
        fetch_json("http://x/", opener=lambda req, timeout=None: Resp(b"[1, 2]"))
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `.venv/bin/pytest tests/test_homelab_checks.py -v`
Expected: FAIL with `ModuleNotFoundError: chiketi.collectors.homelab.checks`.

- [ ] **Step 3: Implement `checks.py`**

```python
"""Talking to the hosts. Every check is read-only and time-boxed."""

from __future__ import annotations

import json
import socket
import subprocess
import urllib.error
import urllib.request

from chiketi.collectors.homelab.config import HomelabConfig, Host
from chiketi.collectors.homelab.probe import ProbeError, ProbeReport, parse_probe
from chiketi.collectors.homelab.rules import HOLD_DOWN, Condition, down

MAX_BODY = 4 * 1024 * 1024


class CheckError(Exception):
    """A check could not get an answer. str() is shown as the issue detail."""


def run_probe(host: Host, cfg: HomelabConfig, runner=subprocess.run,
              timeout: float = 20.0) -> ProbeReport:
    cmd = ["ssh", "-i", cfg.ssh_key, "-p", str(host.port),
           "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
           "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={cfg.known_hosts}",
           "-o", "LogLevel=ERROR", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
           f"{host.user}@{host.address}", "chiketi-probe"]
    try:
        r = runner(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise CheckError("timed out") from None
    except OSError as exc:
        raise CheckError(f"cannot run ssh: {exc}") from None
    if r.returncode != 0:
        err = (r.stderr or "").lower()
        if "host key verification failed" in err or "host identification has changed" in err:
            raise CheckError("host key mismatch")
        if "permission denied" in err:
            raise CheckError("key refused")
        if "no route" in err or "timed out" in err or "refused" in err:
            raise CheckError("no connection")
        raise CheckError(f"ssh exit {r.returncode}")
    try:
        return parse_probe(r.stdout)
    except ProbeError:
        raise CheckError("probe output unreadable") from None


def _tcp(connect, ip: str, port: int) -> bool:
    try:
        s = connect((ip, port), timeout=3.0)
    except OSError:
        return False
    try:
        s.close()
    except OSError:
        pass
    return True


def evaluate_gateway(host: Host, connect=socket.create_connection,
                     resolve=socket.getaddrinfo) -> list[Condition]:
    # TCP 53 rather than ping: the service runs with NoNewPrivileges, which
    # strips ping's file capability.
    if not _tcp(connect, host.address, 53):
        return [Condition("gw", "crit", "Gateway unreachable", f"{host.address} not answering", HOLD_DOWN)]
    out = []
    if not _tcp(connect, host.outside_ip, 443):
        out.append(Condition("wan", "crit", "Internet unreachable", f"cannot reach {host.outside_ip}", HOLD_DOWN))
    try:
        ok = bool(resolve(host.dns_name, 443))
    except OSError:
        ok = False
    if not ok:
        out.append(Condition("dns", "crit", "DNS failing", f"cannot resolve {host.dns_name}", HOLD_DOWN))
    return out


def _token(host: Host) -> str:
    if not host.token_file:
        return ""
    try:
        with open(host.token_file) as f:
            return f.read().strip()
    except OSError:
        return ""


def evaluate_http(host: Host, opener=urllib.request.urlopen) -> list[Condition]:
    req = urllib.request.Request(host.url)
    tok = _token(host)
    if tok:
        req.add_header("Authorization", f"Bearer {tok}")
    try:
        resp = opener(req, timeout=5.0)
        status = getattr(resp, "status", 200)
        resp.close()
    except urllib.error.HTTPError as exc:
        status = exc.code
    except (urllib.error.URLError, OSError) as exc:
        return [down(str(getattr(exc, "reason", exc)))]
    if status != 200:
        return [Condition("down", "crit", f"API answered {status}", host.url, HOLD_DOWN)]
    return []


def fetch_json(url: str, opener=urllib.request.urlopen, timeout: float = 5.0) -> dict:
    try:
        resp = opener(urllib.request.Request(url), timeout=timeout)
        body = resp.read(MAX_BODY)
        resp.close()
        data = json.loads(body)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise CheckError(f"status unavailable: {exc}") from None
    if not isinstance(data, dict):
        raise CheckError("status unavailable: not an object")
    return data
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `.venv/bin/pytest tests/test_homelab_checks.py -v && .venv/bin/ruff check .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chiketi/collectors/homelab/checks.py tests/test_homelab_checks.py
git commit -m "feat(homelab): ssh probe, gateway, http and backup-status checks"
```

---

### Task 5: Poller, collector and registration

**Files:**
- Create: `chiketi/collectors/homelab/poller.py`, `chiketi/collectors/homelab/collector.py`
- Modify: `chiketi/collectors/homelab/__init__.py`, `chiketi/collectors/registry.py`
- Test: `tests/test_homelab_collector.py`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces:
  - `HomelabPoller(cfg: HomelabConfig, baseline: Baseline, clock=time.time, probe=run_probe, gateway=evaluate_gateway, http=evaluate_http, fetch=fetch_json)`
    is a daemon thread with:
    - `.poll_once() -> None`
    - `.snapshot() -> dict`, shaped
      `{"hosts": [{"name", "state"}], "issues": [...], "checked_at": float | None, "poll_seconds": float}`
    - `.stop()`
  - `baseline_path() -> str`, which resolves to `$XDG_STATE_HOME/chiketi/homelab-baseline.json`
  - `HomelabCollector(path: str | None = None, start: bool = True)`, `namespace = "homelab"`.
    `collect()` returns these keys:
    - `homelab.status`: `"ok" | "warn" | "crit" | "pending" | "unconfigured"`
    - `homelab.hosts`
    - `homelab.issues`
    - `homelab.checked_at`, with `extra={"poll_seconds": float}`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_homelab_collector.py
from __future__ import annotations

from chiketi.collectors.homelab.checks import CheckError
from chiketi.collectors.homelab.collector import HomelabCollector
from chiketi.collectors.homelab.config import HomelabConfig, Host
from chiketi.collectors.homelab.poller import HomelabPoller
from chiketi.collectors.homelab.probe import ProbeReport
from chiketi.collectors.homelab.rules import Baseline, Condition, HOLD_DOWN

HOSTS = (
    Host("Atlas", "unraid", address="z", user="root", backup_api="http://z/api"),
    Host("devbox", "linux", address="w", user="user"),
    Host("pfSense", "gateway", address="g"),
    Host("Home Assistant", "http", url="http://ha/api/"),
)


def make(tmp_path, probe, gateway=lambda h: [], http=lambda h: [], fetch=lambda url: {"exit": 0}):
    cfg = HomelabConfig(hosts=HOSTS, poll_seconds=30)
    clock = iter(range(0, 100000, 30))
    return HomelabPoller(cfg, Baseline(str(tmp_path / "b.json")), clock=lambda: next(clock),
                         probe=probe, gateway=gateway, http=http, fetch=fetch)


def healthy(host, cfg):
    return ProbeReport(version=1, kind=host.kind, mem_total_kb=100, mem_avail_kb=80, filesystems={"/": 10.0})


def test_snapshot_before_first_poll(tmp_path):
    snap = make(tmp_path, healthy).snapshot()
    assert snap["checked_at"] is None
    assert [h["state"] for h in snap["hosts"]] == ["unknown"] * 4


def test_all_healthy(tmp_path):
    p = make(tmp_path, healthy)
    p.poll_once()
    snap = p.snapshot()
    assert snap["issues"] == [] and snap["checked_at"] == 0
    assert [h["state"] for h in snap["hosts"]] == ["ok"] * 4


def test_unreachable_after_hold(tmp_path):
    def probe(host, cfg):
        if host.name == "devbox":
            raise CheckError("timed out")
        return healthy(host, cfg)
    p = make(tmp_path, probe)
    for _ in range(HOLD_DOWN):
        p.poll_once()
    (i,) = p.snapshot()["issues"]
    assert (i["host"], i["title"], i["detail"]) == ("devbox", "Unreachable", "timed out")


def test_backup_failure_on_nas(tmp_path):
    p = make(tmp_path, healthy, fetch=lambda url: {"active": False, "exit": 23, "errors": []})
    p.poll_once()
    (i,) = p.snapshot()["issues"]
    assert i["host"] == "Atlas" and i["title"] == "Backup failed"


def test_backup_api_down_is_a_warning(tmp_path):
    def fetch(url):
        raise CheckError("status unavailable: refused")
    p = make(tmp_path, healthy, fetch=fetch)
    for _ in range(HOLD_DOWN):
        p.poll_once()
    (i,) = p.snapshot()["issues"]
    assert i["severity"] == "warn" and i["title"] == "Backup status unavailable"


def test_a_crashing_rule_skips_that_host_only(tmp_path):
    def probe(host, cfg):
        if host.name == "devbox":
            raise RuntimeError("bug")
        return healthy(host, cfg)
    p = make(tmp_path, probe)
    p.poll_once()
    states = {h["name"]: h["state"] for h in p.snapshot()["hosts"]}
    assert states["Atlas"] == "ok"


def test_gateway_issue(tmp_path):
    p = make(tmp_path, healthy, gateway=lambda h: [Condition("wan", "crit", "Internet unreachable", "", 1)])
    p.poll_once()
    assert p.snapshot()["issues"][0]["host"] == "pfSense"


def test_collector_unconfigured(tmp_path):
    c = HomelabCollector(path=str(tmp_path / "missing.toml"))
    m = c.collect()
    assert m["homelab.status"].value == "unconfigured"


def test_collector_invalid_config_is_unconfigured(tmp_path):
    p = tmp_path / "homelab.toml"
    p.write_text("not toml [")
    assert HomelabCollector(path=str(p)).collect()["homelab.status"].value == "unconfigured"


def test_collector_status_levels(tmp_path):
    p = tmp_path / "homelab.toml"
    p.write_text("[[host]]\nname='pfSense'\nkind='gateway'\naddress='g'\n")
    c = HomelabCollector(path=str(p), start=False)
    assert c.collect()["homelab.status"].value == "pending"
    c._poller._gateway = lambda h: [Condition("wan", "crit", "x", "", 1)]
    c._poller.poll_once()
    m = c.collect()
    assert m["homelab.status"].value == "crit"
    assert m["homelab.checked_at"].extra["poll_seconds"] == 30.0
    assert m["homelab.hosts"].value == [{"name": "pfSense", "state": "crit"}]
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `.venv/bin/pytest tests/test_homelab_collector.py -v`
Expected: FAIL with `ModuleNotFoundError: chiketi.collectors.homelab.poller`.

- [ ] **Step 3: Implement `poller.py`**

```python
"""Background poller: checks every host in parallel, off the metric engine's thread."""

from __future__ import annotations

import os
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from chiketi.collectors.homelab.checks import (
    CheckError, evaluate_gateway, evaluate_http, fetch_json, run_probe,
)
from chiketi.collectors.homelab.config import HomelabConfig, Host
from chiketi.collectors.homelab.rules import (
    HOLD_DOWN, Baseline, Condition, IssueTracker, down, evaluate_backup, evaluate_report,
)


def baseline_path() -> str:
    base = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return os.path.join(base, "chiketi", "homelab-baseline.json")


class HomelabPoller(threading.Thread):
    daemon = True

    def __init__(self, cfg: HomelabConfig, baseline: Baseline, clock=time.time,
                 probe=run_probe, gateway=evaluate_gateway, http=evaluate_http,
                 fetch=fetch_json) -> None:
        super().__init__(name="homelab-poller")
        self._cfg, self._baseline, self._clock = cfg, baseline, clock
        self._probe, self._gateway, self._http, self._fetch = probe, gateway, http, fetch
        self._tracker = IssueTracker()
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._checked: set[str] = set()
        self._snap: dict = {"hosts": [{"name": h.name, "state": "unknown"} for h in cfg.hosts],
                            "issues": [], "checked_at": None, "poll_seconds": cfg.poll_seconds}

    def run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.poll_once()
            except Exception as exc:  # never let the thread die
                print(f"chiketi: homelab poll failed: {exc}", file=sys.stderr)
            self._stop_event.wait(self._cfg.poll_seconds * random.uniform(0.9, 1.1))

    def stop(self) -> None:
        self._stop_event.set()

    def _check(self, h: Host, now: float) -> tuple[list[Condition], bool]:
        """(conditions, partial). partial=True leaves the host's other issues as they were."""
        try:
            if h.kind in ("linux", "unraid"):
                try:
                    rep = self._probe(h, self._cfg)
                except CheckError as exc:
                    return [down(str(exc))], True
                conds = evaluate_report(h.name, rep, self._cfg.thresholds, self._baseline, now)
                if h.backup_api:
                    try:
                        conds += evaluate_backup(self._fetch(h.backup_api), self._cfg.thresholds, now)
                    except CheckError as exc:
                        conds.append(Condition("backup_api", "warn", "Backup status unavailable",
                                               str(exc)[:120], HOLD_DOWN))
                return conds, False
            if h.kind == "gateway":
                return self._gateway(h), False
            return self._http(h), False
        except Exception as exc:
            print(f"chiketi: homelab check {h.name} failed: {exc!r}", file=sys.stderr)
            return [], True

    def poll_once(self) -> None:
        now = self._clock()
        hosts = self._cfg.hosts
        with ThreadPoolExecutor(max_workers=min(8, len(hosts))) as ex:
            results = list(ex.map(lambda h: self._check(h, now), hosts))
        for h, (conds, partial) in zip(hosts, results):
            self._tracker.update(h.name, conds, now, partial)
            if conds or not partial:
                self._checked.add(h.name)
        try:
            self._baseline.save()
        except OSError as exc:
            print(f"chiketi: homelab baseline not saved: {exc}", file=sys.stderr)
        snap = {
            "hosts": [{"name": h.name,
                       "state": self._tracker.host_state(h.name) if h.name in self._checked else "unknown"}
                      for h in hosts],
            "issues": self._tracker.issues(),
            "checked_at": now,
            "poll_seconds": self._cfg.poll_seconds,
        }
        with self._lock:
            self._snap = snap

    def snapshot(self) -> dict:
        with self._lock:
            return self._snap
```

- [ ] **Step 4: Implement `collector.py` and the package export**

```python
"""HomelabCollector: exposes the poller's latest snapshot as homelab.* metrics."""

from __future__ import annotations

import sys

from chiketi.collectors.base import MetricCollector, MetricValue
from chiketi.collectors.homelab.config import ConfigError, default_path, load_config
from chiketi.collectors.homelab.poller import HomelabPoller, baseline_path
from chiketi.collectors.homelab.rules import Baseline


class HomelabCollector(MetricCollector):
    namespace = "homelab"

    def __init__(self, path: str | None = None, start: bool = True) -> None:
        self._poller: HomelabPoller | None = None
        path = path or default_path()
        try:
            cfg = load_config(path)
        except FileNotFoundError:
            return
        except ConfigError as exc:
            print(f"chiketi: homelab disabled, {exc}", file=sys.stderr)
            return
        self._poller = HomelabPoller(cfg, Baseline(baseline_path()))
        if start:
            self._poller.start()

    def collect(self) -> dict[str, MetricValue]:
        if self._poller is None:
            return {self._key("status"): MetricValue("unconfigured")}
        snap = self._poller.snapshot()
        issues = snap["issues"]
        if snap["checked_at"] is None:
            status = "pending"
        elif any(i["severity"] == "crit" for i in issues):
            status = "crit"
        elif issues:
            status = "warn"
        else:
            status = "ok"
        return {
            self._key("status"): MetricValue(status),
            self._key("hosts"): MetricValue(snap["hosts"]),
            self._key("issues"): MetricValue(issues),
            self._key("checked_at"): MetricValue(snap["checked_at"], "s",
                                                 available=snap["checked_at"] is not None,
                                                 extra={"poll_seconds": snap["poll_seconds"]}),
        }
```

`chiketi/collectors/homelab/__init__.py`:
```python
"""Home Lab health: remote probes, rules, and the homelab.* metrics."""

from chiketi.collectors.homelab.collector import HomelabCollector

__all__ = ["HomelabCollector"]
```

`chiketi/collectors/registry.py`: add `from chiketi.collectors.homelab import HomelabCollector`
next to the other imports, and before `return collectors`:
```python
    # Home Lab health board. Inert (status "unconfigured", no thread) unless
    # ~/.config/chiketi/homelab.toml exists.
    collectors.append(HomelabCollector())
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `.venv/bin/pytest -q && .venv/bin/ruff check .`
Expected: the whole suite passes. `conftest.isolate_state` points `XDG_CONFIG_HOME` at a tmp
dir, so `get_collectors()` stays inert in tests.

- [ ] **Step 6: Commit**

```bash
git add chiketi/collectors tests/test_homelab_collector.py
git commit -m "feat(homelab): background poller and homelab.* collector"
```

---

### Task 6: `--no-kiosk`

**Files:**
- Modify: `chiketi/__main__.py` (`build_parser`, `main`), `chiketi/app.py` (`run`)
- Test: `tests/test_cli.py`

**Interfaces:**
- Produces: `run(bind_host, token, theme_from_cli=False, no_kiosk=False)`.

- [ ] **Step 1: Write the failing test** (append to `tests/test_cli.py`)

```python
def test_no_kiosk_flag():
    from chiketi.__main__ import build_parser
    assert build_parser().parse_args(["--no-kiosk"]).no_kiosk is True
    assert build_parser().parse_args([]).no_kiosk is False
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `.venv/bin/pytest tests/test_cli.py::test_no_kiosk_flag -v`
Expected: FAIL with `AttributeError: 'Namespace' object has no attribute 'no_kiosk'`.

- [ ] **Step 3: Implement**

In `build_parser()`, after `--token`:
```python
    parser.add_argument(
        "--no-kiosk",
        action="store_true",
        help="Serve the dashboard and API only; never launch the local Chromium "
             "kiosk. For a server that feeds kiosks elsewhere.",
    )
```
In `main()`, pass `no_kiosk=args.no_kiosk` to `run(...)`.
In `app.py`, change the signature to
`def run(bind_host: str = "0.0.0.0", token: str | None = None, theme_from_cli: bool = False, no_kiosk: bool = False) -> int:`
and replace the auto-start block with:
```python
    # Auto-start the kiosk
    if no_kiosk:
        print("chiketi: --no-kiosk, serving only", file=sys.stderr)
    elif _display_mgr._chromium:
        _display_mgr.turn_on()
    else:
        print("chiketi: no Chromium browser found, running headless (server only)",
              file=sys.stderr)
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `.venv/bin/pytest -q && .venv/bin/ruff check .` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chiketi/__main__.py chiketi/app.py tests/test_cli.py
git commit -m "feat: --no-kiosk serves the dashboard without launching Chromium"
```

---

### Task 7: The adaptive frame (no fixed aspect ratio)

**Files:**
- Modify: `chiketi/assets/ui/shared_helpers.js` (append)
- Modify: `chiketi/assets/ui/display_app.js` (scaling script block, `getScreenRegistry`, `buildEnabledScreens`)
- Modify: `chiketi/assets/ui/control_app.js` (`getScreenRegistry`, preview aspect)
- Modify: `chiketi/assets/ui/display.css`, `chiketi/assets/ui/control.css`
- Modify: `chiketi/assets/ui/screen_functions.js` (`bsFrame`)
- Test: `tests/js/render_harness.js`

**Interfaces:**
- Produces, as globals in `shared_helpers.js`:
  - `FRAME_H` (number of kiosk units, default 600)
  - `setFrameH(h)`
  - `layoutClass() -> 'landscape' | 'other'`
  - `fluidH() -> number` (FRAME_H clamped to 576–770)
- `bsFrame(body, fluid)`: with `fluid === true` it emits `class="screen-frame fluid"`.
- Registry entries gain `fluid: boolean`.

- [ ] **Step 1: Write the failing harness test**

In `tests/js/render_harness.js`, after the REGISTRY definition, add:
```js
/* ── The frame model ── */
(function () {
  setFrameH(683);
  if (FRAME_H !== 683 || layoutClass() !== 'landscape' || fluidH() !== 683) {
    console.error('FRAME MODEL: 3:2 frame not landscape/683'); process.exit(1);
  }
  setFrameH(1200);
  if (layoutClass() !== 'other' || fluidH() !== 770) {
    console.error('FRAME MODEL: portrait frame must fall back to clamped landscape'); process.exit(1);
  }
  setFrameH('junk');
  if (FRAME_H !== 600) { console.error('FRAME MODEL: bad input must reset to 600'); process.exit(1); }
  setFrameH(600);
  if (bsFrame('x', true).indexOf('screen-frame fluid') === -1 ||
      bsFrame('x').indexOf('screen-frame fluid') !== -1) {
    console.error('FRAME MODEL: bsFrame fluid flag'); process.exit(1);
  }
})();
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/js/render_harness.js`
Expected: exits non-zero with `ReferenceError: setFrameH is not defined`.

- [ ] **Step 3: Implement the frame model** (append to `shared_helpers.js`)

```js
/* ── Frame model ─────────────────────────────────────────────────────────
 * The frame is always 1024 units wide; its height follows the real screen
 * (683 on a 3:2 Surface Go, 576 at 16:9). display_app.js / control_app.js set
 * it from the screen being drawn; the harness sets it per run.
 *
 * Layout classes are the extension point for screens of other shapes. Only
 * 'landscape' (aspect 1.33-1.78) has layouts today; anything else falls back
 * to the landscape layout, clamped and centred -- never cropped. */
let FRAME_H = 600;
const LANDSCAPE_MIN_H = 576, LANDSCAPE_MAX_H = 770;
function setFrameH(h) {
  const n = Number(h);
  FRAME_H = (isFinite(n) && n >= 100 && n <= 4000) ? Math.round(n) : 600;
}
function layoutClass() {
  return (FRAME_H >= LANDSCAPE_MIN_H && FRAME_H <= LANDSCAPE_MAX_H) ? 'landscape' : 'other';
}
function fluidH() { return Math.max(LANDSCAPE_MIN_H, Math.min(LANDSCAPE_MAX_H, FRAME_H)); }
```

`bsFrame` in `screen_functions.js`: change the signature to `function bsFrame(body, fluid)` and
the opening tag to
``return `<div class="screen-frame${fluid ? ' fluid' : ''}">${S.defs || ''}` +``.

CSS. In `display.css`, after the `.screen-frame` rule:
```css
  .screen-frame.fluid { height: var(--frame-h, 600px); }
  @keyframes hlPulse { 0%,100%{opacity:1} 50%{opacity:0.75} }
```
In `control.css`, after its `.screen-frame` rule:
```css
  @keyframes hlPulse { 0%,100%{opacity:1} 50%{opacity:0.75} }
```

`display_app.js`: replace the first `<script>` block (`scaleDisplay`) with:
```js
<script>
/* Fit the frame to the screen without cropping.
   Fluid screens are 1024 x FRAME_H and fill the screen exactly. Fixed screens
   are 1024x600 and are contained (letterboxed) on any other shape, centred. */
function scaleDisplay() {
  const frame = document.querySelector('.screen-frame');
  if (!frame) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  let s, x = 0, y = 0;
  if (frame.classList.contains('fluid')) {
    s = vw / 1024;
  } else {
    s = Math.min(vw / 1024, vh / 600);
    x = (vw - 1024 * s) / 2;
    y = (vh - 600 * s) / 2;
  }
  frame.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
  frame.style.transformOrigin = 'top left';
  const inner = frame.firstElementChild;
  if (inner) document.body.style.background = getComputedStyle(inner).backgroundColor;
}
function measureFrame() {
  const before = FRAME_H;
  setFrameH(1024 * window.innerHeight / window.innerWidth);
  document.getElementById('display').style.setProperty('--frame-h', FRAME_H + 'px');
  return FRAME_H !== before;
}
new MutationObserver(scaleDisplay).observe(document.getElementById('display'), {childList: true});
window.addEventListener('resize', function () {
  if (measureFrame() && typeof renderDisplay === 'function') renderDisplay();
  scaleDisplay();
});
</script>
```
`FRAME_H` and `setFrameH` come from `shared_helpers.js`, which sits in the second script block.
Both run after page load, so the first call happens inside `poll()`. At the top of `poll()`'s
`try`, add `measureFrame();`.

In `getScreenRegistry` (display_app.js, and the same edit in control_app.js), mark the screens
`fluid`. Each existing entry gets `fluid: false`. Change the clock line to:
```js
  if (fns[4]) screens.push({id: 'screen5', name: 'Clock', fn: fns[4], fluid: fam === 'Sci-Fi'});
```
In `buildEnabledScreens`, carry `fluid` through. Both `.map` and the fallback object get
`fluid: !!s.fluid` (for the fallback, `fluid: !!s0.fluid`).

`control_app.js` preview aspect. It already has `updatePreviewAspectRatio(w, h)`, called with
the display's width and height (lines ~214 and ~336). It currently stretches every preview to
the display's shape. Replace it with the version below, so fluid previews take the display's
shape and fixed screens stay 1024/600, matching what the kiosk now shows:
```js
/* Fluid screens take the controlled display's shape; fixed screens stay
   1024/600, exactly as the kiosk letterboxes them. */
function applyPreviewAspect() {
  document.querySelectorAll('.screen-frame').forEach(f => {
    f.style.aspectRatio = f.classList.contains('fluid') ? '1024 / ' + FRAME_H : '1024 / 600';
  });
}
function updatePreviewAspectRatio(w, h) {
  const before = FRAME_H;
  setFrameH(1024 * (Number(h) || 600) / (Number(w) || 1024));
  if (FRAME_H !== before) renderScreens(); else applyPreviewAspect();
}
```
and add `applyPreviewAspect();` as the last line of `renderScreens()`. In `control.css`, add
only the keyframes (there is no CSS aspect rule; the JS sets it):
`@keyframes hlPulse { 0%,100%{opacity:1} 50%{opacity:0.75} }`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node tests/js/render_harness.js && ./scripts/check_js.sh && .venv/bin/pytest -q tests/test_renderers.py`
Expected: `renderer harness OK`; every file `ok`.

- [ ] **Step 5: Commit**

```bash
git add chiketi/assets/ui tests/js/render_harness.js
git commit -m "feat(ui): frame follows the screen's shape; fixed screens letterbox, never crop"
```

---

### Task 8: Fluid Sci-Fi clock

**Files:**
- Modify: `chiketi/assets/ui/screen_functions.js`: `sfTosScreen2`, `sfTngScreen2`,
  `sfDs9Screen2`. These are the three `return` lines that open `<div class="screen-frame">`.

**Interfaces:**
- Produces: the three clock renderers emit `class="screen-frame fluid"`. Their content is
  already flex-centred at `height:100%`, so it fills any frame height.

- [ ] **Step 1: Make the change**

In each of the three functions, change ``return `<div class="screen-frame"><div style="background:``
to ``return `<div class="screen-frame fluid"><div style="background:``.

- [ ] **Step 2: Add the failing harness assertion**

In `render_harness.js`, in the main fixture loop next to the GPU checks, add:
```js
      if (fixtureName === 'FULL' && /^sf(Tos|Tng|Ds9)Screen2$/.test(fn.name) &&
          html.indexOf('screen-frame fluid') === -1) {
        fail(fixtureName, label, 'Sci-Fi clock must be fluid');
      }
```
Run: `node tests/js/render_harness.js`. Expected: PASS, because Step 1 is done. Then revert
Step 1 in one function, check the harness FAILs, and restore it.

- [ ] **Step 3: Commit**

```bash
git add chiketi/assets/ui/screen_functions.js tests/js/render_harness.js
git commit -m "feat(ui): the Sci-Fi clock fills any landscape screen"
```

The real-browser fit of the clock at all five shapes is verified in Task 10.

---

### Task 9: Home Lab widgets and screen

**Files:**
- Modify: `chiketi/assets/ui/screen_functions.js` (append a "Home Lab" section after the
  Claude screen block, which currently ends near line 3422)
- Modify: `chiketi/assets/ui/display_app.js`, `chiketi/assets/ui/control_app.js` (registry)
- Modify: `tests/js/fixtures.js`, `tests/js/render_harness.js`

**Interfaces:**
- Consumes: the `m()` keys `homelab.status`, `homelab.hosts`, `homelab.issues` and
  `homelab.checked_at` (Task 5); `bsFrame(body, true)`, `fluidH()` and `gq()` (Task 7);
  `bsRegion`, `bsS`, `bsSkin` and `bsGlow` (existing).
- Produces:
  - `hlData() -> {mode, hosts, issues, checkedAt}`, where mode is one of `'nominal'`, `'warn'`,
    `'crit'`, `'stale'`, `'pending'` or `'unconfigured'`
  - `bsAlertBanner(mode, compact)`, `bsHostStrip(hosts)`, `bsIssueCard(issue)`
  - `hlMaxCards() -> number`
  - `bsHomelabScreen(c)`, `sfTosHomelab(c)`, `sfTngHomelab(c)`, `sfDs9Homelab(c)`
  - registry entry `{id: 'screen6', name: 'Home Lab', fn, fluid: true}`

- [ ] **Step 1: Write the fixtures** (`tests/js/fixtures.js`)

Add to `FULL`, so the harness's FULL-coverage rule is met:
```js
  'homelab.status': mval('ok'),
  'homelab.hosts': mval([
    { name: 'Atlas', state: 'ok' }, { name: 'Vesta', state: 'ok' },
    { name: 'devbox', state: 'ok' }, { name: 'gpubox', state: 'ok' },
    { name: 'Lcdhost', state: 'ok' }, { name: 'chiketi-server', state: 'ok' },
    { name: 'pfSense', state: 'ok' }, { name: 'Home Assistant', state: 'ok' },
  ]),
  'homelab.issues': mval([]),
  'homelab.checked_at': mval(Math.floor(Date.now() / 1000) - 5, 's', { poll_seconds: 30 }),
```
Before `module.exports`, add:
```js
function homelab(status, issues, hostStates, checkedAgo) {
  const f = Object.assign({}, FULL);
  f['homelab.status'] = mval(status);
  f['homelab.issues'] = mval(issues);
  if (hostStates) {
    f['homelab.hosts'] = mval(FULL['homelab.hosts'].value.map(function (h, i) {
      return { name: h.name, state: hostStates[i] || 'ok' };
    }));
  }
  if (checkedAgo !== undefined) {
    f['homelab.checked_at'] = mval(Math.floor(Date.now() / 1000) - checkedAgo, 's', { poll_seconds: 30 });
  }
  return f;
}
const NOW_S = Math.floor(Date.now() / 1000);
const HL_YELLOW = homelab('warn', [
  { host: 'gpubox', severity: 'warn', title: '/ 88% full', detail: 'filesystem space', since: NOW_S - 600 },
], ['ok', 'ok', 'ok', 'warn']);
const HL_RED = homelab('crit', (function () {
  const out = [{ host: 'Atlas', severity: 'crit', title: 'disk2 DISK_DSBL', detail: 'Unraid disk status', since: NOW_S - 3600 }];
  for (let i = 0; i < 11; i++) {
    out.push({ host: 'devbox', severity: 'warn', title: 'Issue ' + i, detail: 'detail ' + i, since: NOW_S - i * 60 });
  }
  return out;
})(), ['crit', 'ok', 'warn']);
const HL_STALE = homelab('ok', [], null, 3600);
const HL_PENDING = (function () {
  const f = homelab('pending', []);
  f['homelab.checked_at'] = { value: null, unit: 's', available: false, extra: { poll_seconds: 30 } };
  return f;
})();
const HL_UNCONFIGURED = (function () {
  const f = Object.assign({}, FULL);
  ['homelab.hosts', 'homelab.issues', 'homelab.checked_at'].forEach(function (k) { delete f[k]; });
  f['homelab.status'] = mval('unconfigured');
  return f;
})();
const HL_HOSTILE = (function () {
  const f = homelab('crit', [
    { host: XSS, severity: 'crit', title: XSS, detail: XSS, since: NOW_S },
  ]);
  f['homelab.hosts'] = mval([{ name: XSS, state: 'crit' }, { name: 'ok', state: XSS }]);
  return f;
})();
```
Add `HL_YELLOW, HL_RED, HL_STALE, HL_PENDING, HL_UNCONFIGURED, HL_HOSTILE` to `module.exports`.
`homelab()` must be defined after `FULL` and `XSS`; place it just above `module.exports`.

- [ ] **Step 2: Write the failing harness checks**

In `render_harness.js` REGISTRY, append the Home Lab renderer as a sixth function on the three
Sci-Fi entries only:
`fns: [sfTosScreen1, sfTosNpuScreen, sfTosClaudeScreen, sfTosGpuScreen, sfTosScreen2, sfTosHomelab]`,
and likewise `sfTngHomelab` and `sfDs9Homelab`. The existing index checks (`i === 3` for GPU)
are unaffected.

In the main loop's HOSTILE condition, add `HL_HOSTILE`:
`if (fixtureName === 'HOSTILE' || fixtureName === 'GPU_HOSTILE' || fixtureName === 'HL_HOSTILE') {`

Add these Home Lab assertions inside the main loop:
```js
      if (/Homelab$/.test(fn.name)) {
        const want = { FULL: 'ALL SYSTEMS NOMINAL', HL_YELLOW: 'YELLOW ALERT', HL_RED: 'RED ALERT',
                       HL_STALE: 'TELEMETRY STALE', HL_PENDING: 'ACQUIRING TELEMETRY',
                       HL_UNCONFIGURED: 'HOME LAB NOT CONFIGURED' }[fixtureName];
        if (want && html.indexOf(want) === -1) fail(fixtureName, label, 'banner missing "' + want + '"');
        if (fixtureName === 'HL_RED' && !/\+\d+ MORE/.test(html)) {
          fail(fixtureName, label, 'issues dropped without saying how many');
        }
        if (fixtureName === 'FULL' && /SINCE/.test(html)) fail(fixtureName, label, 'all-clear shows issue cards');
        if (html.indexOf('screen-frame fluid') === -1) fail(fixtureName, label, 'Home Lab must be fluid');
      }
```
After the per-key hostile sweep, add the shape sweep for fluid screens:
```js
// Fluid screens at every supported shape: must render cleanly and stay in cqw.
[576, 600, 640, 683, 768].forEach(function (h) {
  setFrameH(h);
  ['FULL', 'HL_RED', 'HL_YELLOW'].forEach(function (fx) {
    metrics = FIX[fx];
    REGISTRY.filter(function (e) { return e.family === 'Sci-Fi'; }).forEach(function (entry) {
      const colors = FAMILIES[entry.family][entry.variant];
      [entry.fns[4], entry.fns[5]].forEach(function (fn) {
        const label = 'h=' + h + ' ' + entry.variant + ' ' + fn.name;
        let html;
        try { html = fn(colors); } catch (e) { fail(fx, label, 'threw ' + e.message); return; }
        const dirty = html.match(/undefined|NaN|\[object Object\]/);
        if (dirty) fail(fx, label, 'output contains ' + dirty[0]);
        const px = layoutPxHits(html);
        if (px.length) fail(fx, label, 'layout px -- ' + px.slice(0, 4).join(' '));
      });
    });
  });
});
setFrameH(600);
```
Run: `node tests/js/render_harness.js`
Expected: FAIL with `ReferenceError: sfTosHomelab is not defined`.

- [ ] **Step 3: Implement the widgets and screen** (append to `screen_functions.js`)

```js
/* ── Home Lab ────────────────────────────────────────────────────────────
 * Management by exception: when everything is healthy the screen says so and
 * nothing else; when something needs attention it says what, where, since
 * when, worst first. No CPU or memory numbers that do not need attention.
 * Red alert turns the region chrome red, the way an LCARS display does. */
function hlData() {
  const st = m('homelab.status');
  const status = st.available ? String(st.value) : 'unconfigured';
  const hm = m('homelab.hosts'), im = m('homelab.issues'), ck = m('homelab.checked_at');
  const isObj = function (x) { return x && typeof x === 'object'; };
  const hosts = (hm.available && Array.isArray(hm.value)) ? hm.value.filter(isObj) : [];
  const issues = (im.available && Array.isArray(im.value)) ? im.value.filter(isObj) : [];
  const checkedAt = (ck.available && typeof ck.value === 'number' && isFinite(ck.value)) ? ck.value : null;
  const poll = Number(ck.extra && ck.extra.poll_seconds) || 30;
  let mode = { ok: 'nominal', warn: 'warn', crit: 'crit', pending: 'pending' }[status] || 'unconfigured';
  const live = mode === 'nominal' || mode === 'warn' || mode === 'crit';
  if (live && checkedAt === null) mode = 'pending';
  else if (live && Date.now() / 1000 - checkedAt > 3 * poll) mode = 'stale';
  return { mode: mode, hosts: hosts, issues: issues, checkedAt: checkedAt };
}

function hlAgo(epoch) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - epoch));
  if (s < 60) return s + ' S AGO';
  if (s < 3600) return Math.floor(s / 60) + ' MIN AGO';
  return Math.floor(s / 3600) + ' H AGO';
}

function hlClock(epoch) {
  const n = Number(epoch);
  if (!isFinite(n) || n <= 0) return '--:--';
  const d = new Date(n * 1000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function hlStateColor(state) {
  const S = bsS();
  if (state === 'crit') return S.crit;
  if (state === 'warn') return S.warn;
  if (state === 'ok') return S.cLink;
  return S.dim;
}

function bsAlertBanner(mode, compact) {
  const S = bsS();
  const T = {
    nominal: ['ALL SYSTEMS NOMINAL', S.cLink], warn: ['YELLOW ALERT', S.warn],
    crit: ['RED ALERT', S.crit], stale: ['TELEMETRY STALE', S.warn],
    pending: ['ACQUIRING TELEMETRY', S.dim], unconfigured: ['HOME LAB NOT CONFIGURED', S.dim],
  }[mode] || ['HOME LAB NOT CONFIGURED', S.dim];
  // Fit the line to ~940 units of width: tracking adds ~0.85em per character.
  const size = Math.min(compact ? 64 : 96, Math.floor(940 / (T[0].length * 0.85)));
  const pulse = mode === 'crit' ? 'animation:hlPulse 2s ease-in-out infinite;' : '';
  return `<div style="text-align:center;color:${T[1]};font-family:${S.font};font-weight:${S.fw};` +
    `font-size:${gq(size)};line-height:1.1;letter-spacing:${S.ls};white-space:nowrap;` +
    `${bsGlow(16, T[1])};${pulse}">${T[0]}</div>`;
}

function bsHostStrip(hosts) {
  const S = bsS();
  const round = S.r >= 999 ? '999px' : gq(S.r * 2);
  const pills = hosts.slice(0, 12).map(function (h) {
    const col = hlStateColor(h.state);
    const pulse = h.state === 'crit' ? 'animation:hlPulse 2s ease-in-out infinite;' : '';
    return `<div style="display:flex;align-items:center;gap:${gq(9)};padding:${gq(6)} ${gq(16)};` +
        `border:${gq(2)} solid ${col};border-radius:${round}">` +
      `<span style="width:${gq(14)};height:${gq(14)};border-radius:50%;background:${col};` +
        `flex-shrink:0;${pulse}"></span>` +
      `<span style="color:${S.label};font-size:${gq(18)};letter-spacing:${S.ls};` +
        `text-transform:uppercase;white-space:nowrap">${esc(String(h.name))}</span></div>`;
  }).join('');
  return `<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:${gq(12)} ${gq(14)}">${pills}</div>`;
}

function bsIssueCard(i) {
  const S = bsS();
  const col = i.severity === 'crit' ? S.crit : S.warn;
  return `<div style="display:flex;align-items:stretch;gap:${gq(14)};min-height:${gq(50)}">` +
    `<div style="width:${gq(10)};background:${col};border-radius:${S.r >= 999 ? '999px' : '0'};flex-shrink:0"></div>` +
    `<div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center">` +
      `<div style="display:flex;align-items:baseline;gap:${gq(12)};min-width:0">` +
        `<span style="color:${col};font-size:${gq(17)};letter-spacing:${S.ls};text-transform:uppercase;` +
          `white-space:nowrap;flex-shrink:0">${esc(String(i.host || ''))}</span>` +
        `<span style="color:${S.bright};font-size:${gq(24)};white-space:nowrap;overflow:hidden;` +
          `text-overflow:ellipsis">${esc(String(i.title || ''))}</span></div>` +
      `<div style="color:${S.dim};font-size:${gq(16)};white-space:nowrap;overflow:hidden;` +
        `text-overflow:ellipsis">${esc(String(i.detail || ''))}</div></div>` +
    `<div style="color:${S.label};font-size:${gq(16)};letter-spacing:${S.ls};white-space:nowrap;` +
      `align-self:center">SINCE ${hlClock(i.since)}</div></div>`;
}

/* How many cards fit: ~62 units each below a ~300-unit banner and strip. */
function hlMaxCards() { return Math.max(1, Math.min(5, Math.floor((fluidH() - 300) / 62))); }

function bsHomelabScreen(c) {
  const S = bsS();
  const d = hlData();
  const H = fluidH();
  const accent = d.mode === 'crit' ? S.crit : (d.mode === 'warn' || d.mode === 'stale') ? S.warn : S.a1;
  const shown = d.issues.slice(0, hlMaxCards());
  const more = d.issues.length - shown.length;
  const calm = shown.length === 0;
  const right = d.checkedAt !== null ? 'CHECKED ' + hlAgo(d.checkedAt) : '';
  const cards = calm ? '' :
    `<div style="display:flex;flex-direction:column;gap:${gq(12)}">` + shown.map(bsIssueCard).join('') +
    (more > 0 ? `<div style="color:${S.label};font-size:${gq(16)};letter-spacing:${S.ls};` +
      `text-align:right">+${more} MORE</div>` : '') + `</div>`;
  const body = `<div style="height:100%;display:flex;flex-direction:column;` +
      `justify-content:${calm ? 'center' : 'flex-start'};gap:${gq(calm ? 44 : 20)};` +
      `padding-top:${gq(calm ? 0 : 8)}">` +
    bsAlertBanner(d.mode, !calm) + bsHostStrip(d.hosts) + cards + `</div>`;
  // Centred box of the clamped landscape height: fills a landscape frame
  // exactly, and sits centred (never cropped) on any other shape.
  const inner = `<div style="position:absolute;left:0;right:0;top:50%;height:${gq(H)};` +
    `transform:translateY(-50%)">` +
    bsRegion(14, 10, 996, H - 20, 'HOME LAB', accent, right, body, 'flex-start', null, null) + `</div>`;
  return bsFrame(inner, true);
}

function sfTosHomelab(c) { bsSkin(BS_SKIN_TOS); return bsHomelabScreen(c); }
function sfTngHomelab(c) { bsSkin(BS_SKIN_TNG); return bsHomelabScreen(c); }
function sfDs9Homelab(c) { bsSkin(BS_SKIN_DS9); return bsHomelabScreen(c); }
```

Registry (`display_app.js` and `control_app.js`, inside `getScreenRegistry` before
`return screens;`):
```js
  // Home Lab: Sci-Fi only for now (Terminal and Vintage come later), and only
  // on a chiketi that has a homelab.toml -- a stock install gains no empty screen.
  const hl = fam === 'Sci-Fi' ? (v === 'DS9' ? sfDs9Homelab : v === 'TNG' ? sfTngHomelab : sfTosHomelab) : null;
  const hs = m('homelab.status');
  if (hl && hs.available && hs.value !== 'unconfigured') {
    screens.push({id: 'screen6', name: 'Home Lab', fn: hl, fluid: true});
  }
```
`control_app.js` already has `m()` (line ~44) and fetches `/api/metrics`, so no helper is needed.

- [ ] **Step 4: Run all the tests**

Run: `node tests/js/render_harness.js && ./scripts/check_js.sh && .venv/bin/pytest -q && .venv/bin/ruff check .`
Expected: `renderer harness OK`, and everything passes.

- [ ] **Step 5: Commit**

```bash
git add chiketi/assets/ui tests/js
git commit -m "feat(ui): Home Lab screen -- alert banner, host strip, issue cards (Sci-Fi)"
```

---

### Task 10: Real-browser fit check and review screenshots

**Files:**
- Create: `scripts/fit_check.mjs`
- Modify: `.gitignore` (add `fit-shots/`)

**Interfaces:**
- Consumes: a running chiketi on `127.0.0.1:7777`, `tests/js/fixtures.js`, playwright-core,
  and a local Chromium.
- Produces: exit code 0 if no element of the screen's frame extends outside the viewport, and
  PNGs in `fit-shots/`.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
/* Real-browser fit check for fluid screens. Not part of CI (needs Chromium).
 *   npm i --no-save playwright-core
 *   .venv/bin/python -m chiketi --no-kiosk --bind 127.0.0.1 &
 *   CHROME=~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node scripts/fit_check.mjs
 * /api/metrics is replaced with harness fixtures; rotation is pinned to one screen. */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const FIX = require('../tests/js/fixtures.js');

const BASE = process.env.CHIKETI_URL || 'http://127.0.0.1:7777';
const OUT = process.env.OUT || 'fit-shots';
const SHAPES = [[1024, 576], [1024, 600], [1024, 640], [1800, 1200], [1024, 768]];
const THEMES = [['Sci-Fi', 'TOS'], ['Sci-Fi', 'TNG'], ['Sci-Fi', 'DS9']];
const CASES = [['screen6', 'FULL'], ['screen6', 'HL_YELLOW'], ['screen6', 'HL_RED'],
               ['screen6', 'HL_STALE'], ['screen5', 'FULL']];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
let failures = 0;
for (const [fam, variant] of THEMES) {
  for (const [sid, fx] of CASES) {
    for (const [w, h] of SHAPES) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.route('**/api/metrics', r => r.fulfill({ json: FIX[fx] }));
      await page.route('**/api/themes', async r => {
        const j = await (await r.fetch()).json();
        j.active_family = fam; j.active_variant = variant;
        r.fulfill({ json: j });
      });
      await page.route('**/api/display', async r => {
        const j = await (await r.fetch()).json();
        j.screen_rotation = {};
        for (const id of ['screen1', 'screen2', 'screen3', 'screen4', 'screen5', 'screen6']) {
          j.screen_rotation[id] = { enabled: id === sid, duration: 600 };
        }
        r.fulfill({ json: j });
      });
      await page.goto(BASE + '/display');
      await page.waitForSelector('.screen-frame');
      await page.waitForTimeout(800);
      const bad = await page.evaluate(() => {
        const vw = window.innerWidth, vh = window.innerHeight, out = [];
        document.querySelectorAll('.screen-frame *').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) {
            out.push(el.tagName + ' ' + (el.textContent || '').trim().slice(0, 30) +
                     ` [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
          }
          if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflow === 'hidden' &&
              !/ellipsis/.test(getComputedStyle(el).textOverflow)) {
            out.push(el.tagName + ' clips content: ' + (el.textContent || '').trim().slice(0, 30));
          }
        });
        return out.slice(0, 5);
      });
      const name = `${variant}-${sid}-${fx}-${w}x${h}`;
      await page.screenshot({ path: `${OUT}/${name}.png` });
      if (bad.length) { failures++; console.error('FAIL', name, bad); } else { console.log('ok  ', name); }
      await page.close();
    }
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it**

```bash
cd ~/projects/chiketi
npm i --no-save playwright-core >/dev/null
echo "fit-shots/" >> .gitignore; echo "node_modules/" >> .gitignore   # skip any already present
sort -u -o .gitignore .gitignore
.venv/bin/python -m chiketi --no-kiosk --bind 127.0.0.1 & CH=$!
sleep 3
CHROME=$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node scripts/fit_check.mjs; RC=$?
kill $CH; echo "rc=$RC"
```
Expected: 75 `ok` lines and `rc=0`. If a case FAILs, fix the layout and re-run until it passes.
The most likely failure is HL_RED at 576 running out of height. Fix it in this order:
- lower `hlMaxCards()`'s divisor margin (300 → 320)
- reduce `bsIssueCard` `min-height` 50 → 44
- reduce the attention-mode gap 20 → 14

Do not hide the overflow.

- [ ] **Step 3: The quality gate (the owner reviews)**

Build a contact sheet so the owner can review it: the 1800×1200 PNGs for each variant (FULL,
HL_YELLOW, HL_RED and the clock), next to an existing hand-made Sci-Fi screen (`screen1` at
1024×600), as one image:
```bash
.venv/bin/python - <<'EOF'
from PIL import Image  # pip install pillow into the venv if missing; dev only, not a chiketi dependency
import glob
files = sorted(glob.glob("fit-shots/*-1800x1200.png"))
ims = [Image.open(f).convert("RGB").resize((600, 400)) for f in files]
cols = 4
sheet = Image.new("RGB", (600 * cols, 400 * ((len(ims) + cols - 1) // cols)))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * 600, (i // cols) * 400))
sheet.save("fit-shots/contact-sheet.png")
EOF
```
For `screen1`, add one more case (`['screen1', 'FULL']`) to `CASES` temporarily, re-run, and
include it. **Stop here and show the owner the sheet.** Make any changes he asks for to the
widgets, then continue.

- [ ] **Step 4: Commit**

```bash
git add scripts/fit_check.mjs .gitignore
git commit -m "test: real-browser fit check for fluid screens at five shapes"
```

---

### Task 11: chiketi-server service and deploy script (kiosk-deploy)

**Files (in `/home/user/projects/kiosk-deploy/chiketi-server/`):**
- Create: `homelab.toml`, `chiketi.service`, `deploy.sh`

- [ ] **Step 1: Write `homelab.toml`**

```toml
# Hosts watched by chiketi's Home Lab screen on chiketi-server. No secrets in here:
# the SSH key and the HA token live only on chiketi-server (~/.ssh/chiketi_homelab,
# ~/.config/chiketi/ha_token, mode 600).
poll_seconds = 30
ssh_key = "~/.ssh/chiketi_homelab"

[thresholds]
# Defaults are in chiketi/collectors/homelab/config.py. The Atlas->Vesta backup
# is not on a fixed schedule yet, so its age is not checked (0); failures are.
backup_max_age_h = 0

[[host]]
name = "Atlas"
kind = "unraid"
address = "192.0.2.212"
user = "root"
backup_api = "http://192.0.2.212:8765/api/status"

[[host]]
name = "Vesta"
kind = "unraid"
address = "192.0.2.214"
user = "root"

[[host]]
name = "devbox"
kind = "linux"
address = "192.0.2.159"
user = "user"

[[host]]
name = "gpubox"
kind = "linux"
address = "192.0.2.57"   # DHCP: check before deploying (see home-lab hosts notes)
user = "gpubox"

[[host]]
name = "Lcdhost"
kind = "linux"
address = "192.0.2.215"
user = "user"

[[host]]
name = "chiketi-server"
kind = "linux"
address = "127.0.0.1"
user = "user"

[[host]]
name = "pfSense"
kind = "gateway"
address = "192.0.2.1"

[[host]]
name = "Home Assistant"
kind = "http"
url = "http://192.0.2.30:8123/api/"
token_file = "~/.config/chiketi/ha_token"
```

- [ ] **Step 2: Write `chiketi.service`**

```ini
[Unit]
Description=chiketi dashboard server for the kiosk-deploy kiosks (Home Lab health)
After=network-online.target
Wants=network-online.target

[Service]
User=user
EnvironmentFile=-/etc/chiketi/env
ExecStart=/opt/chiketi/venv/bin/chiketi --no-kiosk --bind 0.0.0.0
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/user/.config/chiketi /home/user/.local/state/chiketi
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Write `deploy.sh`** (`chmod 755`)

```bash
#!/usr/bin/env bash
# Deploy a chiketi commit from the Atlas folder to chiketi-server. This is an explicit
# copy of committed code, never a sync: chiketi-server runs its own copy, so it keeps
# working when Atlas is down. Usage: ./deploy.sh [git-ref]   (default HEAD)
set -euo pipefail
HOST=${HOST:-user@192.0.2.203}
SRC=${SRC:-/home/user/projects/chiketi}
REF=${1:-HEAD}
HERE=$(cd "$(dirname "$0")" && pwd)
sha=$(git -C "$SRC" rev-parse --short "$REF")
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
git -C "$SRC" archive --format=tar.gz -o "$tmp/chiketi.tgz" "$REF"
scp -q "$tmp/chiketi.tgz" "$HERE/homelab.toml" "$HERE/chiketi.service" "$HOST:/tmp/"
ssh "$HOST" "set -e
  d=\$(date +%Y%m%d)
  mkdir -p ~/.config/chiketi ~/.local/state/chiketi
  [ -f ~/.config/chiketi/homelab.toml ] && cp -p ~/.config/chiketi/homelab.toml ~/.config/chiketi/homelab.toml.bak-\$d
  [ -f /etc/systemd/system/chiketi.service ] && sudo cp -p /etc/systemd/system/chiketi.service /etc/systemd/system/chiketi.service.bak-\$d
  sudo rm -rf /opt/chiketi/src.new && sudo mkdir -p /opt/chiketi/src.new
  sudo tar -xzf /tmp/chiketi.tgz -C /opt/chiketi/src.new
  [ -x /opt/chiketi/venv/bin/pip ] || sudo python3 -m venv /opt/chiketi/venv
  sudo /opt/chiketi/venv/bin/pip install -q --upgrade /opt/chiketi/src.new
  sudo rm -rf /opt/chiketi/src && sudo mv /opt/chiketi/src.new /opt/chiketi/src
  echo $sha | sudo tee /opt/chiketi/DEPLOYED >/dev/null
  install -m600 /tmp/homelab.toml ~/.config/chiketi/homelab.toml
  sudo install -m644 /tmp/chiketi.service /etc/systemd/system/chiketi.service
  rm -f /tmp/chiketi.tgz /tmp/homelab.toml /tmp/chiketi.service
  sudo systemctl daemon-reload && sudo systemctl enable -q chiketi && sudo systemctl restart chiketi"
for _ in $(seq 1 20); do
  if curl -fsS -m3 "http://${HOST#*@}:7777/api/health" >/dev/null; then echo "deployed $sha"; exit 0; fi
  sleep 1
done
echo "chiketi did not come up; see: ssh $HOST journalctl -u chiketi -n 50" >&2
exit 1
```

- [ ] **Step 4: One-time chiketi-server prep, then the first deploy**

```bash
ssh user@192.0.2.203 'set -e
  sudo apt-get install -y -qq python3-venv >/dev/null
  [ -f ~/.ssh/chiketi_homelab ] || ssh-keygen -q -t ed25519 -N "" -C chiketi-homelab@chiketi-server -f ~/.ssh/chiketi_homelab
  sudo install -d -m700 /etc/chiketi
  [ -f /etc/chiketi/env ] || echo "CHIKETI_TOKEN=$(head -c 24 /dev/urandom | base64 | tr -d "/+=")" | sudo tee /etc/chiketi/env >/dev/null
  sudo chmod 600 /etc/chiketi/env
  cat ~/.ssh/chiketi_homelab.pub'
cd /home/user/projects/kiosk-deploy/chiketi-server && ./deploy.sh
curl -s http://192.0.2.203:7777/api/metrics | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['homelab.status'])"
```
Expected: `deployed <sha>`, then `pending` or `crit`. It will be crit because no probe is
installed yet, so every host goes "Unreachable (key refused)" after about 2 minutes. That is
correct.

The control-panel token is only in `/etc/chiketi/env`. the owner opens
`http://192.0.2.203:7777/#token=<value>`, and I read the value out to him in the session
when he wants it.

---

### Task 12: Probe on the Linux hosts (devbox, gpubox, Lcdhost, chiketi-server)

**Files:**
- Create: `/home/user/projects/kiosk-deploy/chiketi-server/install-probe.sh`

- [ ] **Step 1: Write `install-probe.sh`** (`chmod 755`)

```bash
#!/usr/bin/env bash
# Install chiketi-probe on one Linux host and let chiketi-server's key run ONLY it.
# Usage: ./install-probe.sh user@host     (run from devbox)
set -euo pipefail
TARGET=$1
SRC=${SRC:-/home/user/projects/chiketi/chiketi/assets/probe}
PUB=$(ssh user@192.0.2.203 cat .ssh/chiketi_homelab.pub)
scp -q "$SRC/chiketi-probe" "$SRC/smart-read" "$TARGET:/tmp/"
ssh "$TARGET" "set -e
  d=\$(date +%Y%m%d); u=\$(id -un)
  command -v smartctl >/dev/null || sudo apt-get install -y -qq smartmontools >/dev/null
  sudo install -m755 /tmp/chiketi-probe /usr/local/bin/chiketi-probe
  sudo install -D -m755 /tmp/smart-read /usr/local/lib/chiketi-probe/smart-read
  rm -f /tmp/chiketi-probe /tmp/smart-read
  echo \"\$u ALL=(root) NOPASSWD: /usr/local/lib/chiketi-probe/smart-read\" | sudo tee /etc/sudoers.d/91-chiketi-probe >/dev/null
  sudo chmod 440 /etc/sudoers.d/91-chiketi-probe && sudo visudo -c >/dev/null
  mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && cp -p ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak-\$d
  grep -qF 'chiketi-homelab@chiketi-server' ~/.ssh/authorized_keys ||
    echo 'command=\"/usr/local/bin/chiketi-probe\",restrict $PUB' >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  /usr/local/bin/chiketi-probe | head -3"
# Pin the host key into chiketi-server's own known_hosts (first contact, from inside the LAN).
HOSTPART=${TARGET#*@}
ssh user@192.0.2.203 "touch ~/.config/chiketi/homelab_known_hosts
  ssh-keygen -F '$HOSTPART' -f ~/.config/chiketi/homelab_known_hosts >/dev/null ||
    ssh-keyscan -t ed25519 '$HOSTPART' 2>/dev/null >> ~/.config/chiketi/homelab_known_hosts
  ssh -i ~/.ssh/chiketi_homelab -o BatchMode=yes -o StrictHostKeyChecking=yes \
      -o UserKnownHostsFile=~/.config/chiketi/homelab_known_hosts ${TARGET} anything-at-all | head -2"
```
The last line proves the restriction. Whatever command is asked for, the forced command runs
the probe instead, so the output starts with `probe_version=1`.

- [ ] **Step 2: Install on the four Linux hosts**

Check gpubox's current address first: `ssh gpubox@192.0.2.57 hostname`. If it fails, find
gpubox as described in the home-lab hosts notes, and fix `homelab.toml` and redeploy.
```bash
cd /home/user/projects/kiosk-deploy/chiketi-server
./install-probe.sh user@192.0.2.159     # devbox
./install-probe.sh gpubox@192.0.2.57     # gpubox (address as verified)
./install-probe.sh user@192.0.2.215     # Lcdhost
./install-probe.sh user@192.0.2.203     # chiketi-server itself
# chiketi-server checks itself at 127.0.0.1, so also pin the host key under that name:
ssh user@192.0.2.203 'ssh-keyscan -t ed25519 127.0.0.1 2>/dev/null >> ~/.config/chiketi/homelab_known_hosts'
```
Expected for each host: `probe_version=1` twice (the local run and the restricted-key run).

- [ ] **Step 3: Check the screen data**

```bash
sleep 70; curl -s http://192.0.2.203:7777/api/metrics | python3 -c "
import json,sys; d=json.load(sys.stdin)
print(d['homelab.status']['value']); print(d['homelab.hosts']['value']); print(d['homelab.issues']['value'])"
```
Expected: the four Linux hosts are `ok`, or show real issues worth a look. Atlas and Vesta still
show Unreachable (key refused), and pfSense and HA are `ok`, except HA → "API answered 401"
until the token is placed (Task 14).

---

### Task 13: Probe on Atlas and Vesta — needs the owner's approval

**Files:**
- Create: `/home/user/projects/kiosk-deploy/chiketi-server/unraid-probe.md` (a record of exactly what was
  done)

- [ ] **Step 1: Read-only inspection (no changes)**

```bash
for h in 192.0.2.212 192.0.2.214; do echo "== $h"; ssh root@$h '
  grep -E "^(mdState|sbSyncErrs)=" /var/local/emhttp/var.ini
  grep -E "^\[|^status=" /var/local/emhttp/disks.ini | paste - - | head -30
  ls -la /root/.ssh/ /boot/config/ssh/ 2>&1 | head -20
  cat /boot/config/go
  command -v smartctl lsblk'; done
```
If root SSH to Vesta isn't set up, ask the owner for access. Don't guess.
Confirm that the probe's assumptions hold:
- `mdState` exists, and so does `sbSyncErrs`. If the parity-error key has another name, update
  the probe's awk, re-run Task 1's tests, and commit.
- Note which disk statuses appear, and check `UNRAID_OK` covers the normal ones (empty slots).
- Find where Unraid persists root's `authorized_keys`. On Unraid 6.9+ it is usually
  `/boot/config/ssh/root/authorized_keys`, copied to `/root/.ssh` at boot.

- [ ] **Step 2: Ask the owner**

Show him the exact list of changes for each Unraid host:
1. Copy `chiketi-probe` and `smart-read` to `/boot/config/chiketi/`.
2. Add two `install` lines to `/boot/config/go`, so they are reinstalled to `/usr/local/...`
   at every boot. Back up `go` first as `go.bak-YYYYMMDD`.
3. Add one restricted line to root's persistent `authorized_keys`, backed up first.
4. Install now as well (the same `install` lines), so it works without a reboot.

Proceed only on an explicit yes.

- [ ] **Step 3: Install (after approval)**

For each Unraid host, set `H` and `KEYFILE` (the persistent authorized_keys path found in
Step 1), then run:
```bash
H=192.0.2.212; KEYFILE=/boot/config/ssh/root/authorized_keys   # adjust per Step 1
PUB=$(ssh user@192.0.2.203 cat .ssh/chiketi_homelab.pub)
scp -q ~/projects/chiketi/chiketi/assets/probe/{chiketi-probe,smart-read} root@$H:/tmp/
ssh root@$H "set -e; d=\$(date +%Y%m%d)
  mkdir -p /boot/config/chiketi
  cp /tmp/chiketi-probe /tmp/smart-read /boot/config/chiketi/ && rm -f /tmp/chiketi-probe /tmp/smart-read
  cp -p /boot/config/go /boot/config/go.bak-\$d
  grep -q chiketi-probe /boot/config/go || cat >> /boot/config/go <<'EOF'
# chiketi-probe: read-only health probe for chiketi-server's Home Lab screen
install -D -m755 /boot/config/chiketi/chiketi-probe /usr/local/bin/chiketi-probe
install -D -m755 /boot/config/chiketi/smart-read /usr/local/lib/chiketi-probe/smart-read
EOF
  install -D -m755 /boot/config/chiketi/chiketi-probe /usr/local/bin/chiketi-probe
  install -D -m755 /boot/config/chiketi/smart-read /usr/local/lib/chiketi-probe/smart-read
  cp -p $KEYFILE $KEYFILE.bak-\$d
  grep -qF chiketi-homelab@chiketi-server $KEYFILE || echo 'command=\"/usr/local/bin/chiketi-probe\",restrict $PUB' >> $KEYFILE
  [ $KEYFILE = /root/.ssh/authorized_keys ] || cp $KEYFILE /root/.ssh/authorized_keys
  /usr/local/bin/chiketi-probe | head -5"
ssh user@192.0.2.203 "ssh-keyscan -t ed25519 $H >> ~/.config/chiketi/homelab_known_hosts
  ssh -i ~/.ssh/chiketi_homelab -o BatchMode=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile=~/.config/chiketi/homelab_known_hosts root@$H whoami | head -2"
```
Expected: `probe_version=1` from both runs. The restricted key cannot run `whoami`; it gets the
probe instead. Record what was done in `unraid-probe.md`, including the backup file names and
how to undo it: remove the key line, remove the go lines, and delete `/boot/config/chiketi`.

---

### Task 14: Home Assistant token, the Go's fallback page, and the live checks

**Files:**
- Create: `/home/user/projects/kiosk-deploy/kiosk-1/shell.html`
- Modify: `/home/user/projects/kiosk-deploy/kiosk-1/chromium-kiosk.sh` (default URL)
- Modify: `/home/user/projects/kiosk-deploy/CLAUDE.md` (chiketi-server section, deploy commands)

- [ ] **Step 1: HA token**

the owner creates a long-lived access token in HA under Profile → Security. He picks a non-admin
user if he has one, since only `/api/` is called. He then writes the token on chiketi-server himself,
so it never passes through the chat:
`ssh -t user@192.0.2.203 'read -rsp "HA token: " t && printf %s "$t" > ~/.config/chiketi/ha_token && chmod 600 ~/.config/chiketi/ha_token && echo saved'`
Expected: within about 2 minutes Home Assistant goes `ok`.

- [ ] **Step 2: Write `shell.html`**

```html
<!doctype html>
<meta charset="utf-8">
<title>kiosk</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
  #down { position: fixed; inset: 0; display: none; background: #000; color: #ffb000;
          font: 600 3.2vw/1.4 sans-serif; align-items: center; justify-content: center;
          flex-direction: column; text-align: center; }
  #clock { font-size: 14vw; color: #ccc; }
</style>
<iframe id="f" src="http://192.0.2.203:7777/display"></iframe>
<div id="down"><div id="clock"></div><div id="msg"></div></div>
<script>
/* The Go's only local page. It shows chiketi-server's dashboard and, if chiketi-server
   stops answering for 30 s, says so instead of freezing or going blank. */
const BASE = 'http://192.0.2.203:7777';
let lastOk = Date.now(), downSince = null;
function hhmm(t) { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
async function check() {
  try {
    await fetch(BASE + '/api/health', { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (downSince !== null) {
      downSince = null;
      document.getElementById('down').style.display = 'none';
      document.getElementById('f').src = BASE + '/display';
    }
    lastOk = Date.now();
  } catch (e) {
    if (downSince === null && Date.now() - lastOk > 30000) {
      downSince = lastOk;
      document.getElementById('msg').textContent =
        'Dashboard server unreachable since ' + hhmm(downSince) + '. chiketi-server may be down.';
      document.getElementById('down').style.display = 'flex';
    }
  }
}
setInterval(function () { document.getElementById('clock').textContent = hhmm(Date.now()); }, 1000);
setInterval(check, 10000);
check();
</script>
```

- [ ] **Step 3: Point the Go at it**

Do this only after the owner has seen the contact sheet (Task 10) and says to switch. The Go
currently shows the session-feed page, and switching moves it to Clock + Home Lab until the
other screens exist.
```bash
cd /home/user/projects/kiosk-deploy/kiosk-1
sed -i 's#^URL=.*#URL="${KIOSK_URL:-file:///home/user/kiosk/shell.html}"#' chromium-kiosk.sh   # was http://192.0.2.159:8766/
d=$(date +%Y%m%d)
ssh user@192.0.2.202 "cp -p ~/kiosk/chromium-kiosk.sh ~/kiosk/chromium-kiosk.sh.bak-$d"
scp shell.html chromium-kiosk.sh user@192.0.2.202:~/kiosk/
ssh user@192.0.2.202 'sudo systemctl restart kiosk && sleep 15 && XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 grim /tmp/s.png'
scp user@192.0.2.202:/tmp/s.png /tmp/claude-1000/-home-user-projects-kiosk-deploy/eaf4f136-426d-46fa-b182-cc7af6a65b28/scratchpad/go-live.png
```
Look at the screenshot. Expected: the Home Lab or Clock screen, full screen, with no cropping
or bars.

- [ ] **Step 4: Live checks**

- A real warning: on chiketi-server, fill a small ext4 loop image past 85 %. tmpfs won't do,
  because the probe ignores it:
  ```bash
  ssh user@192.0.2.203 'truncate -s 20M /tmp/t.img && mkfs.ext4 -q /tmp/t.img &&
    sudo mkdir -p /mnt/fittest && sudo mount -o loop /tmp/t.img /mnt/fittest && sudo fallocate -l 17M /mnt/fittest/f'
  ```
  Expected: within about 1 minute, YELLOW ALERT with "chiketi-server · /mnt/fittest 9x% full". Then
  `ssh user@192.0.2.203 'sudo umount /mnt/fittest && rm /tmp/t.img'`. Expected: it clears
  within about 1 minute.
- Fallback page: `ssh user@192.0.2.203 sudo systemctl stop chiketi`. Expected: after about
  30–40 s the Go shows "Dashboard server unreachable since …". Then
  `sudo systemctl start chiketi`. Expected: the dashboard returns within about 10 s.
  If `fetch` from a `file://` page is blocked on the Go, the overlay appears even while
  chiketi-server is up. In that case, serve `shell.html` from chiketi-server at the same address. That
  loses the fallback's independence, so tell the owner before choosing this route.
- the owner's review on the real screen.

- [ ] **Step 5: Update the kiosk-deploy notes and commit the chiketi branch state**

Update `CLAUDE.md`:
- the chiketi-server row and layout (`chiketi-server/`: `deploy.sh`, `install-probe.sh`, `homelab.toml`,
  `unraid-probe.md`)
- how to deploy (`cd chiketi-server && ./deploy.sh`)
- where the secrets live (only on chiketi-server)
- the Go now opens `shell.html`

In chiketi, make sure everything is committed (`git status` clean), then run
`.venv/bin/pytest -q && node tests/js/render_harness.js && ./scripts/check_js.sh && .venv/bin/ruff check .`.
