# Home Lab screen: design spec

- **Date:** 2026-10-20
- **Status:** Draft. the owner approved the screen design in conversation; this document is waiting for his review.
- **Topic:** A Home Lab health screen built on remote health collectors. It is chiketi's first screen that pulls data from other machines, and the first screen used by the kiosk-deploy project.
- **Branch:** `feat/homelab-screen`

## Why

chiketi was built to show one machine's own statistics. kiosk-deploy will use chiketi as the
display platform for room kiosks (the first is a Surface Go, 1800×1200). The kiosks should show
things that matter. The first such screen is the **Home Lab** screen. It answers one question:
*does anything in the home lab need my attention?*

It follows the "management by exception" approach. When everything is healthy, the screen
stays calm and shows only that fact. When something needs attention, the screen says what
and where, in order of severity. Numbers that don't need attention are never shown, so there
is no CPU or memory clutter.

The other kiosk-deploy screens (My Day, Home, Claude sessions, local AI) get their own specs later.
This spec also covers the groundwork they will share: remote collection, a display frame that
adapts to the screen's shape, and running headless on a server.

## Success criteria

1. With all hosts healthy, the screen shows **ALL SYSTEMS NOMINAL** and one light per host,
   and no metrics.
2. A real problem appears within about 2 check cycles (≤ 2 min), and the screen shows the host,
   the problem, the value and since when. It clears automatically once the problem is fixed.
3. Brief blips never show. A problem must persist before it is raised.
4. Every remote access is read-only and enforced by the target host, not by chiketi-server.
5. The Home Lab and Clock screens render in all three Sci-Fi variants (TOS, TNG, DS9), pass the
   renderer harness, and are laid out natively, not cropped or letterboxed, at every supported
   shape from 16:9 to 4:3, including the Go's 3:2.
6. A slow or dead host never delays the rest of chiketi's metrics.

## Scope

**In scope**
- A `homelab` collector, with its own background poller, check rules and a config file.
- A small read-only health probe script for the target hosts (Linux and Unraid variants).
- New widgets in the Bridge Station engine: alert banner, host light strip, issue card.
- The Home Lab screen (`screen6`) for the Sci-Fi family.
- A display frame that adapts to the screen's aspect ratio, with fluid (any-shape) layouts for
  Home Lab and the Sci-Fi Clock.
- A `--no-kiosk` flag so chiketi can run as a server only.
- Deployment to chiketi-server, with the Go pointed at it, and a local fallback page on the Go.

**Out of scope (later specs)**
- Terminal and Vintage versions of this screen. Their renderer is `null`, so they skip the
  screen in rotation. Vintage gets an annunciator-panel design later.
- My Day, Home, the Claude sessions screen and the AI screen.
- Alert sounds and notifications, history and graphs, and any action buttons (it is read-only).

## Architecture

```
 chiketi-server (192.0.2.203, independent of Atlas)
 ┌───────────────────────────────────────────────────────────────┐
 │ chiketi --no-kiosk (systemd)                                   │
 │  MetricEngine ── homelab collector ── reads cache (instant)    │
 │                        ▲                                       │
 │            HomelabPoller thread (every 30 s, parallel)         │
 │   ssh -i homelab_key host  ──► forced command: chiketi-probe   │
 │   HTTP GET Atlas :8765/api/status  (backup)                     │
 │   HTTP GET Home Assistant /api/  (reachability)                │
 │   ICMP/TCP + DNS lookup         (pfSense, internet)            │
 │  HTTP :7777  /display  /api/metrics                            │
 └───────────────────────────────────────────────────────────────┘
            ▲ browser
   kiosk-1: Chromium → local fallback page → iframe /display
```

### Hosts and checks

The host list comes from config (see below). The initial set has 8 hosts:

| Host | Kind | How it is checked |
|---|---|---|
| Atlas | unraid | probe over SSH; backup status API |
| Vesta | unraid | probe over SSH |
| devbox | linux | probe over SSH |
| gpubox | linux | probe over SSH (also reports GPU temperatures) |
| Lcdhost | linux | probe over SSH |
| chiketi-server | linux | probe over SSH to `127.0.0.1`, the same path as every other host. That way the service's sandbox never needs `sudo`. |
| pfSense | gateway | ping the gateway; resolve an external name through it; reach an outside IP |
| Home Assistant | http | `GET /api/` with a read-only token |

kiosk-1 is deliberately left out (the owner's call: a kiosk doesn't need to watch itself).

### Rules

Each rule produces an **issue** with a `severity` of `warn` or `crit`. A rule only fires after
its condition holds for its **hold** time. The hold times use a jittered 30 s poll and are
measured in consecutive bad checks, so a hold of 2 checks means about 1 minute. An issue clears
after 2 consecutive good checks.

| Rule | Warn | Crit | Hold |
|---|---|---|---|
| Host unreachable (probe failed or timed out) | — | 4 failed checks in a row (~2 min) | 4 |
| Filesystem used (each real filesystem; Unraid array disks, cache and pools) | ≥ 85 % | ≥ 95 % | 2 |
| Memory available (`MemAvailable/MemTotal`) | < 10 % | < 5 % | 10 (~5 min) |
| SMART: reallocated, pending or offline-uncorrectable count rose since the first sighting, or the drive's own health check says FAILED | count rose | health check FAILED | 1 |
| CPU package temperature | ≥ 85 °C | ≥ 95 °C | 4 |
| Disk temperature | ≥ 50 °C | ≥ 60 °C | 4 |
| GPU temperature (gpubox) | ≥ 85 °C | ≥ 92 °C | 4 |
| Failed systemd units (Linux) | any | — | 2 |
| Pending security updates older than 14 days (apt) | yes | — | 1 |
| Unraid array not started / disk disabled or missing | — | yes | 1 |
| Unraid parity errors (last check) | > 0 | — | 1 |
| Atlas backup (from `:8765/api/status`) | last success > 26 h ago | last run failed | 1 |
| Internet: outside IP unreachable or DNS resolution fails, while the gateway is up | — | yes | 4 |
| Gateway (pfSense LAN IP) unreachable | — | yes | 4 |
| Home Assistant API unreachable or not 200 | — | yes | 4 |

SMART uses the "rose since first sighting" baseline because many drives carry an old non-zero
count that is harmless. The baseline is saved in chiketi-server's state file
(`$XDG_STATE_HOME/chiketi/homelab-baseline.json`), so it survives restarts.

The thresholds live in the config file and the values above are the defaults, so the owner can
tune them without a code change.

### The probe (`chiketi-probe`)

A POSIX `sh` script, with no Python needed (Unraid has none). It only reads, and it prints
`key=value` lines for chiketi to parse. Unknown keys are ignored, so the probe and the
collector can evolve separately.

```
probe_version=1
kind=linux|unraid
mem_total_kb=… mem_avail_kb=…
fs=<mount>|<used_pct>                  (one line per real filesystem)
cpu_temp_c=…                           (max over coretemp/k10temp packages, if present)
disk=<dev>|<model>|<temp_c>|<realloc>|<pending>|<offline_unc>|<health PASSED/FAILED>
gpu_temp_c=…                           (nvidia-smi, if present)
failed_units=<n>|<names, comma separated>
sec_updates=<n>|<oldest pending, days>  (Debian/Ubuntu)
unraid_array=Started|Stopped
unraid_disk=<name>|<status>            (DISK_OK / DISK_DSBL / DISK_NP …, from /var/local/emhttp/disks.ini)
unraid_parity_errors=<n>
```

- SMART needs root. On Linux hosts, one sudoers line lets the probe user run only
  `smartctl -H -A -j /dev/*` (read-only flags). Unraid runs the probe as root.
- **Enforcement:** the target's `authorized_keys` entry for chiketi-server's key is
  `command="/usr/local/bin/chiketi-probe",restrict`. The key can run nothing else: no
  shell, no port forwarding, no PTY.
- **On Unraid** the root filesystem is in RAM, so the probe and the key are kept on the flash
  drive (`/boot/config/…`) and reinstalled at boot by a line in `/boot/config/go`. This is a
  change on Atlas and Vesta, and it is read-only in effect. the owner approves it before it is
  installed (see the rollout).
- The probe runs with a 15 s timeout on the remote side, and chiketi-server's SSH call has a 20 s
  timeout.

### Config: `$XDG_CONFIG_HOME/chiketi/homelab.toml`

chiketi has no config file today; persistent settings are in `state.json`. Home Lab gets its
own TOML file, read with the standard library's `tomllib`, so no dependency is added. If the
file is missing, the collector is inactive and the screen's data shows "not configured".

```toml
poll_seconds = 30
ssh_key = "~/.ssh/chiketi_homelab"      # private key, mode 600, chiketi-server only

[thresholds]                             # optional overrides of the defaults above
fs_warn_pct = 85

[[host]]
name = "Atlas"
kind = "unraid"                          # unraid | linux | gateway | http
address = "192.0.2.212"
user = "root"
backup_api = "http://192.0.2.212:8765/api/status"

[[host]]
name = "Home Assistant"
kind = "http"
url = "http://192.0.2.30:8123/api/"
token_file = "~/.config/chiketi/ha_token"   # read-only token, mode 600
```

The real file, with the owner's addresses, lives in the kiosk-deploy project (`chiketi-server/homelab.toml`)
and is copied to chiketi-server on deployment. Secrets (the SSH key and the HA token) are never kept
in either repository.

### Collector output (metric keys)

The `homelab` namespace follows chiketi's existing shape (`MetricValue`):

| Key | Value |
|---|---|
| `homelab.status` | `"ok"` / `"warn"` / `"crit"` / `"unconfigured"` |
| `homelab.hosts` | list of `{name, state: ok/warn/crit/unknown}`, in config order |
| `homelab.issues` | list of `{host, severity, title, detail, since}`, sorted crit→warn, then oldest first |
| `homelab.checked_at` | epoch seconds of the last complete poll |

`collect()` only reads the poller's cache under a lock, so it returns immediately. The poller
checks hosts in parallel (`ThreadPoolExecutor`, at most 8 at a time) using the system `ssh`
binary through `subprocess`, with `BatchMode=yes`, `ConnectTimeout=5` and `StrictHostKeyChecking=yes`
against a dedicated `known_hosts` file. No new Python dependency is added.

Issue text is built only by the collector, from parsed numbers and known keys, never
from raw remote strings, except for disk models, unit names and filesystem paths. Those are
truncated, and the display escapes them like every other value. The harness's HOSTILE fixture
covers these fields.

## Display

### Adaptive frame (no fixed aspect ratio)

the owner's requirement: the kiosks must not be limited to one aspect ratio. Every screen in the
kiosk-deploy rotation is laid out for whatever screen shape it is shown on.

Today `scaleDisplay` scales the fixed 1024×600 frame to cover the screen and crops the
overflow. On the Go (3:2) that cuts about 12 % off the sides. The change:

- The frame keeps a fixed width of 1024 units, and its height follows the screen:
  `1024 × (viewport height / viewport width)`, so 683 units on the Go and 576 at 16:9. It is
  exposed as a CSS variable `--frame-h`, and screens can read it as `c.frameH`.
- Each screen in the registry gains a `fluid` flag.
  - **Fluid screens** use the whole frame. Their layouts are written in terms of the
    available height: flex rows and columns, with spacing scaled to it. They never use fixed
    y-coordinates that assume 600.
  - **Non-fluid screens** render in a 1024×600 box centred in the frame, with the family's
    background filling the rest. They are never cropped.
- **Fluid in this spec:** the Home Lab screen (new), and the **Clock** screen for the Sci-Fi
  family, re-laid out so it fills any shape while keeping its current look. the owner keeps the
  Clock in the rotation.
- **Not fluid yet:** System Stats, NPU, Claude Usage and GPU. They aren't in the Go's rotation.
  Any screen that joins a kiosk rotation later gets a fluid version as part of its own spec. The
  later kiosk-deploy screens (My Day, Home, Claude sessions, local AI) are fluid from the start.
- **Layout classes (the extension point).** chiketi must not be tied to one resolution or
  orientation. A screen's renderer receives `c.layoutClass`, which is derived from the frame's
  shape. This spec implements one class, **`landscape`** (aspect 1.33–1.78), which covers the
  Go (3:2) and the original 7" panel (1024×600). Screens may also offer layouts for later
  classes. The planned ones are `portrait`, `strip` (very wide, like the Lcdhost LCD,
  1920×462) and size-aware density for large or distant screens. Each will arrive in its own
  spec without reworking this one. On a shape with no matching class, a screen falls back to
  its landscape layout centred in the frame, with no cropping.
- **Supported shapes:** from 16:9 to 4:3 in landscape. Every fluid screen is tested at
  **16:9 (1024×576), 1024×600, 16:10 (1024×640), 3:2 (1024×683) and 4:3 (1024×768)**.
  Portrait and strip shapes come later, as new layout classes (see above).
- The control panel's preview uses the shape of the display being controlled, which comes from
  `/api/display`. Until that's known, it uses 1024×600.

### Widgets (Bridge Station additions)

New primitives next to `bsRegion` and `bsSegBar`. They use cqw units only (the harness rule),
and colours come from the skin's roles (`crit`, `warn`, and the normal accent):

- **`bsAlertBanner(status, checkedAgo)`** — the large status line. "ALL SYSTEMS NOMINAL" in the
  normal accent; **YELLOW ALERT** with the `warn` role; **RED ALERT** with the `crit` role. In
  red alert, the skin's frame chrome (spine, elbows, tabs) switches to the `crit` colour, as
  LCARS displays do during red alert. For TOS that is red `#BF0F0F`; for TNG, mars `#FF2200`;
  for DS9, alert `#FF4444`. A slow pulse (a CSS animation, opacity 1→0.75, 2 s) runs on the
  banner only during red alert.
- **`bsHostStrip(hosts)`** — one pill per host: the name and a status lamp. The lamp is the
  only colour; there are no numbers. It wraps to two rows if needed.
- **`bsIssueCard(issue)`** — a row with a severity bar, a host tag, a title (for example
  "Disk 3: 2 reallocated sectors"), a detail line and "since 14:02". The cards stack, and at
  most 5 are visible. After that comes a "+N more" line, with crit cards always first.

Each Sci-Fi skin keeps its own chrome. TOS uses spine regions, TNG uses pill tabs and DS9
uses chamfered tabs, all from the existing `_bsChrome*` code.

### Screen layout (`screen6`, "Home Lab")

```
 ┌──────────────────────────────────────────────────────────────┐
 │  HOME LAB                                     checked 12 s ago│  family header chrome
 │                                                              │
 │            ALL SYSTEMS NOMINAL   /   RED ALERT               │  bsAlertBanner (big)
 │                                                              │
 │  [● ATLAS] [● VESTA] [● DEVBOX] [● GPUBOX] [● LCDHOST] …     │  bsHostStrip
 │                                                              │
 │  (all clear: empty, calm space)                              │
 │  (attention: issue cards, worst first)                       │  bsIssueCard × ≤5
 └──────────────────────────────────────────────────────────────┘
```

- **All clear:** the banner and the host strip, centred vertically, with generous space.
- **Attention:** the banner moves up and the issue cards fill the space below.
- **Unconfigured:** the banner reads "HOME LAB NOT CONFIGURED". This only happens on a chiketi
  without `homelab.toml`.
- **Data stale:** if `checked_at` is more than 3 poll intervals old, the banner reads
  "TELEMETRY STALE" in the `warn` role. A stalled collector must never look healthy.

### Rotation

`screen6` is added to `getScreenRegistry()` in `display_app.js` and `control_app.js`, and to
the harness's copy of the registry. It is enabled by default only when `homelab.status` is not
`unconfigured`, so a stock chiketi install doesn't gain an empty screen.

## Running on chiketi-server

- `chiketi --no-kiosk` is a new flag. It skips the Chromium kiosk, even if a browser is installed.
- It is installed in a venv at `/opt/chiketi` from a pinned commit, copied from the Atlas
  folder at deploy time. chiketi-server runs its local copy, so it keeps working when Atlas is down.
  It is never a live mount, and nothing syncs automatically: files only change when we deploy.
- `chiketi.service` (systemd) runs as an unprivileged user with `Restart=always`, the sandboxing used
  for the session feed (`ProtectSystem=strict`, etc.), `CHIKETI_TOKEN` from an environment file
  (mode 600), and binds `0.0.0.0:7777`.
- `kiosk-deploy/chiketi-server/` holds `homelab.toml`, the unit file and a `deploy.sh`. The deploy script
  copies a chiketi commit and the config over, reinstalls, restarts and checks `/api/health`.

## The Go's fallback page

The Go's Chromium opens a local file, `~/kiosk/shell.html`. It shows
`http://192.0.2.203:7777/display` full screen in an iframe and polls `/api/health` every
10 s. If chiketi-server doesn't answer for 30 s, the page covers the iframe with
**"Dashboard server unreachable since 14:02. chiketi-server may be down."** and a clock. It
recovers automatically. This page is the only per-device file, and it is the same on
every kiosk.

## Error handling

- The poller never raises into the engine. A failed host becomes "unreachable" through the
  rule, and a bug in a rule is logged and skipped for that cycle.
- Probe output that can't be parsed is logged once per host per hour and counts as a failed
  check.
- A missing or invalid `homelab.toml` makes the status "unconfigured" and logs one clear error.
- The SSH host key is pinned (`StrictHostKeyChecking=yes`). A changed key means that host is
  unreachable, with the detail "host key mismatch". It is never accepted silently.

## Testing

- **Python (pytest):**
  - probe output parsing, using fixture probe outputs (healthy, full disk, failed SMART,
    Unraid with a disabled disk, garbage)
  - each rule's thresholds and hold/clear behaviour, using a fake clock
  - the SMART baseline persistence
  - config validation
  - the poller's timeout handling, using a fake `ssh` script on `PATH`
- **Probe:** `shellcheck`, plus a test that runs it on devbox and checks the required keys.
- **JS harness:**
  - add fixtures for `homelab.*` in all-clear, yellow, red, stale and unconfigured states,
    plus 9 hosts and 12 issues (the overflow path)
  - add HOSTILE strings in the host, title and detail fields
  - all three Sci-Fi variants, each at all five supported shapes (the harness gets a
    `frameH` per run)
  - a new harness check: on fluid screens, no element may extend past `frameH`
  - the existing checks apply: no px, escaping, keys present in `FULL`
- **Visual check:** screenshot each state with headless Chromium at every supported shape,
  including 1800×1200 (the Go) and 1024×600. the owner reviews them side by side with an existing hand-made Sci-Fi screen. This is
  the agreed quality gate for the widget-kit approach.
- **Live check:** after deploying, cause a real warning, for example filling a scratch
  filesystem on chiketi-server past 85 %. Confirm it appears within about 1 minute and clears after
  cleanup.

## Rollout

1. Build and test on devbox, on the chiketi branch.
2. Install the probe on devbox, gpubox, Lcdhost and chiketi-server. These are Linux hosts and the
   change is reversible.
3. **Ask the owner before touching Atlas and Vesta.** Install the probe there, add the key line and
   the `/boot/config/go` line, with backups of every file changed (`*.bak-YYYYMMDD`).
4. Deploy chiketi to chiketi-server. Point the Go at the fallback page.
5. the owner reviews it live.

## Inputs needed from the owner

- Vesta: 192.0.2.214, Unraid backup server (confirmed 2026-10-20).
- Home Assistant: 192.0.2.30:8123 (confirmed; `/api/` answers 401 without a token, as expected).
- Still needed: a read-only long-lived Home Assistant access token, at deployment time.
- Approval for step 3 of the rollout, when we reach it.
