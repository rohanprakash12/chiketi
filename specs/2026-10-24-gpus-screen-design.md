# GPUs: a Kiosk screen for every GPU in the house

Status: written 2026-10-24 while Rohan was away ("just keep going"). The choices marked
**[parked]** are his to confirm. This builds on `specs/2026-10-23-screen-modes-design.md`.

## Why

Rohan wants one place that shows every GPU in the house and what state it is in:
- which are working and which are idle;
- which are hot or throttling;
- which machine has gone away, or has a GPU it can no longer read.

Today a GPU is visible only on its own machine (the Self GPU screen), and Home Lab raises an
issue only when a GPU is too hot. GPUs is the first Kiosk screen to be built after Home Lab
and Sessions. Its tab already exists, grey.

**Success:** on the Go and the LCD, the GPUs tab lights up and shows each GPU (today: the
Tesla V100s in the house GPU workstation), without anyone opening a terminal. Each GPU shows
its load, memory, temperature, power and a one-word state, worst first. When data is missing
or old, the screen says so rather than looking calm.

## Scope

**In:**
- NVIDIA GPUs on the hosts Home Lab already probes (`homelab.toml`, kinds `linux` and
  `unraid`), including a server that probes itself at `127.0.0.1`;
- a full layout and a strip layout, in Sci-Fi/TOS and Others/Claude;
- the tab's attention colour;
- one Home Lab issue per GPU, covering both heat and throttling.

**Out:**
- AMD and Intel GPUs on remote hosts (there are none in the house; the probe can grow them
  later);
- process names and PIDs (only a count is shown, for privacy and payload size);
- history graphs;
- chiketi's *local* GPU collector (see decision 1).

## Decisions

1. **[parked] Data comes only from the Home Lab probe**, not from chiketi's local GPU
   collector.
   - Every GPU host is already a Home Lab host, and the server can probe itself over
     loopback. Using both sources would list a server's GPUs twice.
   - A house without Home Lab has no GPUs screen (the screen `needs: "homelab"`).
2. **[parked] One row per GPU, like Sessions**, rather than the Self GPU screen's dials. The
   point is a house-wide summary that reads across a room and fits the 1920×462 LCD.
3. **[parked] The states.** The first match wins:

   | State | When |
   |---|---|
   | `OFFLINE` | the host did not answer this poll; its last readings stay, dimmed, with their age |
   | `UNREADABLE` | the host answered but its GPU query failed (driver not loaded, a GPU off the bus, a timeout); the last readings stay, dimmed |
   | `CRITICAL` | temperature ≥ `gpu_crit_c` (92 °C by default) |
   | `HOT` | temperature ≥ `gpu_warn_c` (85 °C by default) |
   | `THROTTLING` | the driver reports a thermal or hardware slowdown (bits below) |
   | `NO DETAIL` | the host runs a version-1 probe, which reports only a temperature |
   | `UNKNOWN` | a version-2 reading with neither utilisation nor a process count |
   | `BUSY` | utilisation ≥ 10 %, or at least one compute process |
   | `IDLE` | otherwise |

   - The clock-event bits that count as throttling are 0x08 (hardware slowdown), 0x20
     (software thermal), 0x40 (hardware thermal) and 0x80 (hardware power brake).
   - The ordinary 0x04 "software power cap" under load is **not** throttling.
4. **[parked] Existing displays are not changed.**
   - New Kiosk displays get `["lab", "sessions", "gpus"]`.
   - The Go and the LCD keep their screens until GPUs is ticked in the control panel.
5. **[parked] The probe must be redeployed to each GPU host** (`chiketi-site deploy probe
   <host>`) for anything beyond temperatures. Until then, that host's GPUs show `NO DETAIL`.

## 1. The probe (`assets/probe/chiketi-probe`, version 2)

The probe stays read-only, takes no arguments, keeps the fixed `PATH`, and runs under dash
and on Unraid. It now prints `probe_version=2`.

**GPU lines**, printed only when `nvidia-smi` exists:

```
gpu_query=ok | gpu_query=fail|<exit code>
gpu=<index>|<name>|<util %>|<memory used MiB>|<memory total MiB>|<temp °C>|<power W>|<power limit W>|<fan %>|<clock event reasons hex>|<pci bus id>
gpu_procs_query=ok | gpu_procs_query=fail|<exit code>
gpu_procs=<pci bus id>|<count>
```

**How the probe gets them:**
- **No `nvidia-smi`:** no `gpu_*` lines at all. The host has no NVIDIA GPU as far as
  chiketi can tell.
- **One detailed query:**
  `nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks_throttle_reasons.active,pci.bus_id --format=csv,noheader,nounits`.
  - The output and exit status are captured with `out=$(…); rc=$?`, never through a pipe
    whose status would be lost.
  - If it fails *and its output names an invalid field*, it is retried once with
    `clocks_event_reasons.active`. Newer drivers keep the throttle name as an alias, so this
    is rare and fails fast.
  - Any other failure prints `gpu_query=fail|<rc>` and no `gpu=` lines.
- **Reading the output:**
  - fields split on `, `;
  - a line without exactly 11 fields is dropped;
  - `[N/A]`, `[Not Supported]` and anything non-numeric in a numeric field become empty;
  - `|` and `=` are stripped from the name and bus id, and the name is cut to 40 characters.
- **The version-1 `gpu_temp_c=` lines** are now printed from the detailed sample, one per
  GPU that has a temperature. There is no second query, and the two can never disagree.
- **The process count:**
  `nvidia-smi --query-compute-apps=gpu_bus_id --format=csv,noheader`, counted per bus id.
  - On success, `gpu_procs_query=ok`; a GPU without a `gpu_procs` line has 0 processes.
  - On failure, `gpu_procs_query=fail|<rc>` and every count is unknown.
  - Process names and PIDs are never printed.
- **Time limits:** where `timeout` exists, the detailed query and its one retry are each
  limited to 5 s, and the process query to 4 s. The GPU part therefore takes at most 14 s.
  The poller's SSH limit (`run_probe`) rises from 20 s to 30 s, which leaves room for the
  rest of the probe and is still within the 30 s poll.

## 2. Parsing, state and alerts (`collectors/homelab/`)

**`probe.py`**
- New fields: `ProbeReport.gpu_query` (`"ok"`, `"fail"` or `None` when there was no query)
  and `ProbeReport.gpus`.
- A `Gpu` dataclass: `index`, `name`, `util`, `vram_used`, `vram_total`, `temp`, `power`,
  `power_limit`, `fan`, `throttle` (an int or None), `bus_id`, `procs` (an int or None).
- A `gpu=` line is dropped if its index is missing or not an integer, or if it does not have
  11 fields. At most 16 GPUs per host.
- `procs` is 0 when `gpu_procs_query=ok` and the GPU has no `gpu_procs` line, and None when
  that query failed or is absent.
- `_float()` (used by every probe field) now rejects NaN and infinity. The throttle field is
  parsed as hexadecimal (`0x…`).
- **Version 1:** with `probe_version=1`, `gpus` is built from the `gpu_temp_c` lines as
  temperature-only entries with indices 0, 1, … and `detail=False`.

**`rules.py`**
- `gpu_state(gpu, thresholds, host_outcome) -> str` implements decision 3.
- **One condition per GPU:** `gpu_temp:<index>` (the existing key, so a running issue
  carries over).
  - Its severity and title come from heat *or* throttling: crit `GPU <i> <t>°C`, warn
    `GPU <i> <t>°C`, or warn `GPU <i> throttling`.
  - Hold is `HOLD_TEMP`. The tracker keeps a raised condition when its title or severity
    changes under the same key, so throttling turning into heat (or back) never drops the
    alert.
  - Indices come from `report.gpus` (version 2) or the legacy order (version 1).

**`poller.py`** keeps, per linux/unraid host:
- the last GPU list;
- `gpu_seen_at`: the time of the last successful GPU sample;
- `outcome`, one of:
  - `ok`: `gpu_query=ok`;
  - `none`: no `nvidia-smi`;
  - `offline`: the probe failed;
  - `unreadable`: `gpu_query=fail`;
  - `pending`: not reached since start-up.

After each poll the snapshot gains:
- `"gpus"`: in `homelab.toml` host order, then index order, each entry is
  `{host, index, name, util, vram_used, vram_total, temp, power, power_limit, fan, procs, state, detail, seen_at}`.
  - With outcome `offline` or `unreadable`, the host's previous GPUs stay, with that state.
  - With outcome `ok` and no `gpu=` lines, the host has none (a removed card does not
    linger).
  - With `none` or `pending`, there are no rows.
- `"gpu_hosts"`: `[{host, outcome}]` for every linux/unraid host.

**`collector.py`** adds `homelab.gpus` and `homelab.gpu_hosts`.
- Both become available once the first poll has finished.
- `homelab.gpus` carries `extra = {"warn_c", "crit_c"}` from the thresholds.

## 3. The screen

**Wiring:**
- `screens.json`: `gpus` becomes `built: true` with `needs: "homelab"`, and the Kiosk
  defaults become `["lab", "sessions", "gpus"]`.
- `KIOSK_RENDERERS` gains `gpus: sfTosGpus` (TOS) and `claudeGpus` (Claude), wrappers over
  `bsGpusScreen(c)`.

**Freshness:**
- The screen reuses Home Lab's staleness rule (`hlData()`: `checked_at` older than three
  poll intervals). When stale, the status bar turns warn, the strip lead and full banner say
  `TELEMETRY STALE`, and the tab turns warn.
- A row that is not fresh (`OFFLINE`, `UNREADABLE`) shows `SEEN <age>` under its state, and
  is left out of the power total.

**Full layout** (Sessions' frame: status bar, `bsHeader('gpus')`, body, footer):
- **Columns:**
  - a mark, a small GPU glyph in the state colour;
  - `GPU <index> · <name>` over the host;
  - STATE (with `SEEN <age>` when not fresh);
  - LOAD (segmented bar and %);
  - VRAM (bar and `used / total G`, where G = MiB / 1024; one decimal on used);
  - TEMP, in the thermal colour;
  - POWER (`W / limit W`);
  - PROCS.
- **Missing values** show `--` and an empty bar, never 0. A percentage needs a total
  greater than 0.
- **Order:** CRITICAL, HOT, THROTTLING, UNREADABLE, OFFLINE, NO DETAIL, UNKNOWN, BUSY,
  IDLE. Within a state, host order then index.
- **Row size:** rows grow up to 1.25× when there are few, as Sessions does. Overflow shows
  `+N MORE`.
- **Status bar colour:** crit if any GPU is CRITICAL. Warn if any GPU is HOT, THROTTLING,
  UNREADABLE or OFFLINE, or the data is stale. Otherwise the calm edge colour.
- **Footer**, cut to fit:
  `N GPUS · B BUSY · <W> W NOW · CHECKED <age>`. Two notes may follow, when they apply:
  - `<hosts> NEED THE NEW PROBE` when there are NO DETAIL rows;
  - `NOT YET REACHED: <hosts>` for pending hosts.
- **Empty states:**
  - Home Lab pending: `ACQUIRING TELEMETRY`.
  - No GPU rows and some host `pending`, `offline` or `unreadable`:
    `GPU INVENTORY INCOMPLETE — <hosts>`, with a warn status bar.
  - Otherwise: `NO GPUS REPORTED`.

**Strip layout** (`bsStripFrame`):
- the lead is `N GPUS · B BUSY · H HOT` in the status colour (or `TELEMETRY STALE`);
- compact rows: `GPU i · name · host`, state, load %, VRAM %, temp, power;
- `+N MORE` on overflow.

**Tab attention** (`bsTabAttention`) for `gpus`:
- crit if any GPU is CRITICAL;
- warn if any GPU is HOT, THROTTLING, UNREADABLE or OFFLINE, the inventory is incomplete,
  or the data is stale.

Every probe string (names, hosts, bus IDs) goes through `esc()`, and every layout size
through `gq()`.

## 4. Testing

**pytest:**
- **Parser:**
  - full version-2 output and version-1 output;
  - `[N/A]` fields, NaN and inf, a bad index, the wrong field count, more than 16 GPUs;
  - processes by bus id: a query that succeeds with none (0) and a query that fails (None);
  - `gpu_query=fail`.
- **The probe script**, using a test-only copy whose `PATH=` line has a directory of fakes
  put first. The test asserts that the production file's `PATH=` line is unchanged. With a
  fake `nvidia-smi`:
  - a normal sample;
  - the invalid-field retry;
  - a non-field failure (no retry; `gpu_query=fail|rc`);
  - a hang (cut off by `timeout`);
  - a failing process query;
  - no `nvidia-smi` at all.

  The script runs under `dash` where installed (otherwise `sh`). Its output contains no
  process names or PIDs; the fake records its arguments and the test checks that only the
  two query forms were used. The existing `probe_version == 1` assertion becomes 2.
- **`gpu_state`:** every state, and every threshold boundary.
- **The single GPU condition** across poller cycles, through `IssueTracker`:
  - throttling turning into crit and back, with the issue never dropping;
  - oscillating across a threshold;
  - a partial (offline) cycle.
- **Poller snapshot:**
  - order;
  - offline and unreadable keep their rows and `seen_at`;
  - a removed card disappears after `ok`;
  - version-1 rows;
  - `pending` at start, and a restart during an outage (no rows, outcome `offline`).
- **Collector:** the metrics.

**Harness:**
- `FULL` gains `homelab.gpus` and `homelab.gpu_hosts`.
- New fixtures:
  - `GPU_HOUSE`: one of each state;
  - `GPU_HOUSE_NONE`;
  - `GPU_HOUSE_INCOMPLETE`;
  - `GPU_HOUSE_STALE`;
  - `GPU_HOUSE_SPARSE`: nulls and a total of 0;
  - `GPU_HOUSE_MANY`: overflow;
  - `GPU_HOUSE_HOSTILE`: names, hosts and bus IDs. It is registered with the leak check,
    as are the other hostile fixtures.
- Checks:
  - each state word on its own in a fixture that fits;
  - order and exact `+N MORE` counts;
  - no `undefined`, `NaN` or bare `0%` for a missing value;
  - full and strip layouts at every shape;
  - the layout-px rule.
- The plan check's ready set gains `gpus` for `FULL` and `SESS_UNCONFIGURED`, but not for
  `HL_UNCONFIGURED` or `KIOSK_EMPTY`.

**Browser:**
- `fit_check` works out readiness from `screens.json`'s `needs`. It runs `gpus:FULL`,
  `gpus:GPU_HOUSE` and `gpus:GPU_HOUSE_MANY` at 1800×1200 and 1920×462, with 2, 5 and 7 tabs.
- `devices_check`:
  - new Kiosk displays get `lab,sessions,gpus`;
  - a display saved with `["lab","sessions"]` keeps exactly that after a restart.

## 5. Rollout

1. Branch `gpus-screen`.
2. The plan, reviewed by Codex until approved.
3. Build.
4. The branch, reviewed by Codex until approved.
5. `chiketi-site deploy server --dry-run`.
6. Rohan's OK, then deploy the server.
7. With his OK, `chiketi-site deploy probe <host>` for each GPU host.
8. Tick GPUs on the displays.
