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
   | `BUSY` | utilisation ≥ 10 %, or at least one compute process (either known signal is enough) |
   | `IDLE` | utilisation known and < 10 % **and** process count known and 0 |
   | `UNKNOWN` | anything else (a signal is missing and the other does not show activity) |

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

**GPU lines.** When there is no `nvidia-smi`, the probe prints only `gpu_tool=absent`.
Otherwise:

```
gpu_query=ok|<rows nvidia-smi returned> | gpu_query=fail|<exit code>
gpu=<index>|<name>|<util %>|<memory used MiB>|<memory total MiB>|<temp °C>|<power W>|<power limit W>|<fan %>|<clock event reasons hex>|<pci bus id>
gpu_procs_query=ok | gpu_procs_query=fail|<exit code>
gpu_procs=<pci bus id>|<count>
```

**How the probe gets them:**
- **No `nvidia-smi`:** only `gpu_tool=absent`.
- **One detailed query:**
  `nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks_throttle_reasons.active,pci.bus_id --format=csv,noheader,nounits`.
  - The output and exit status are captured with `out=$(…); rc=$?`, never through a pipe
    whose status would be lost.
  - If it fails *and its output names an invalid field*, it is retried once with
    `clocks_event_reasons.active`. Newer drivers keep the throttle name as an alias, so this
    is rare and fails fast.
  - Any other failure prints `gpu_query=fail|<rc>` and no `gpu=` lines.
  - On success, `gpu_query=ok|<n>` gives the number of lines `nvidia-smi` returned, so the
    collector can tell an empty inventory (`n` = 0) from lines that were rejected.
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
  limited to 5 s, and the process query to 4 s, so the GPU part takes at most 14 s. Where it
  does not, there is no per-call bound, and the poller's SSH limit is the only one.
  - That limit (`run_probe`) rises from 20 s to 30 s.
  - A poll takes as long as its slowest host (eight run at once), and the next poll starts
    `poll_seconds` after it finishes. A refresh can therefore take up to about
    `poll_seconds + 30 s`, and the staleness rule in §3 allows for that.

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
  temperature-only entries with indices 0, 1, … and `detail=False`, and `gpu_query` is
  `"legacy"`.
- **Rejected lines:** `gpu_rows` holds the count from `gpu_query=ok|<n>`. `gpu_tool` is
  `"absent"` when the probe printed `gpu_tool=absent`.

**`rules.py`**
- `gpu_state(gpu, thresholds, host_outcome) -> str` implements decision 3.
- `IssueTracker.update()` gains `keep_prefixes=()`: keys starting with one of these
  prefixes that the update does not mention are left exactly as they were, as for a partial
  update. Every other key clears normally.
  - When a host answers but its GPU telemetry is unavailable (`unreadable`), the poller
    passes `keep_prefixes=("gpu_temp:",)`.
  - So a raised GPU alert survives a failed GPU query, while that host's filesystem and
    memory issues still clear normally.
  - Cached readings are never evaluated again as new evidence.
- **One condition per GPU:** `gpu_temp:<index>` (the existing key, so a running issue
  carries over).
  - Its severity and title come from heat *or* throttling: crit `GPU <i> <t>°C`, warn
    `GPU <i> <t>°C`, or warn `GPU <i> throttling`.
  - Hold is `HOLD_TEMP`. The tracker keeps a raised condition when its title or severity
    changes under the same key, so throttling turning into heat (or back) never drops the
    alert.
  - Indices come from `report.gpus` (version 2) or the legacy order (version 1).

**`poller.py`** keeps, per linux/unraid host:
- the last GPU list and `gpu_seen_at`, the time of the last successful GPU sample;
- `outcome`, one of:

  | Outcome | When |
  |---|---|
  | `ok` | `gpu_query=ok`, and every returned line was accepted |
  | `legacy` | a version-1 probe that reported at least one temperature (a successful, temperature-only sample) |
  | `none` | `gpu_tool=absent`, or a version-1 probe with no temperatures, *and* no GPUs known for the host |
  | `unreadable` | any of: `gpu_query=fail`; fewer lines accepted than `nvidia-smi` returned (the whole sample is then discarded, accepted lines included); `gpu_tool=absent` for a host whose GPUs are known; or a version-1 probe with no temperatures for a host whose GPUs are known |
  | `offline` | the probe failed |
  | `pending` | not reached since start-up, and nothing remembered |

**Remembered across restarts:**
- Each host's last GPU list and `gpu_seen_at` are kept in the existing Home Lab baseline
  file (`homelab-baseline.json`, key `"gpus"`). They are loaded at start-up as rows with
  state `offline`, so a restart during an outage still shows the GPU workstation, with its
  age, instead of an empty screen.
- A GPU is "known" for a host if it is in that remembered list.

After each poll the snapshot gains:
- `"gpus"`: in `homelab.toml` host order, then index order, each entry is
  `{host, index, name, util, vram_used, vram_total, temp, power, power_limit, fan, procs, state, detail, seen_at}`.
  - With outcome `offline` or `unreadable`, the host's known GPUs stay, with that state
    and their `seen_at`.
  - An `unreadable` sample is never used, not even partly, so every GPU on such a host is
    either remembered (UNREADABLE, with its age) or absent. Since no GPU of that host has
    fresh evidence, preserving all its `gpu_temp:` keys (`keep_prefixes`) is exact.
  - Only a full `ok` confirms the inventory: a known GPU missing from it is removed (a
    pulled card does not linger).
  - A `legacy` sample replaces that host's rows entirely with its temperature list. A
    version-1 probe cannot say which card is which, so its rows are approximate by design.
  - With `none` or `pending`, there are no rows.
- `"gpu_hosts"`: `[{host, outcome}]` for every linux/unraid host.

**`collector.py`** adds `homelab.gpus` and `homelab.gpu_hosts`.
- Both become available once the first poll has finished.
- `homelab.gpus` carries `extra = {"warn_c", "crit_c", "published_at", "stale_after"}`.

## 3. The screen

**Wiring:**
- `screens.json`: `gpus` becomes `built: true` with `needs: "homelab"`, and the Kiosk
  defaults become `["lab", "sessions", "gpus"]`.
- `KIOSK_RENDERERS` gains `gpus: sfTosGpus` (TOS) and `claudeGpus` (Claude), wrappers over
  `bsGpusScreen(c)`.

**Freshness:**
- **Staleness** is judged on `homelab.gpus`' own `extra.published_at` (when the snapshot
  was published, i.e. the poll *finished*) and `extra.stale_after` (seconds). Both are set
  by the collector, which knows the schedule:
  `stale_after = 2 × (1.1 × poll_seconds + ceil(hosts / 8) × 30)`.
  - That is two full cycles at the worst case: the 10 % jitter, the 30 s SSH limit, and
    eight hosts at a time.
  - The display marks the GPU data stale when `now − published_at > stale_after`.
  - Home Lab's own screen keeps its rule; `checked_at` (the poll start) stays as it is.
- **When stale:**
  - every row counts as not fresh;
  - the status bar and the tab are warn, even over a cached CRITICAL (each row keeps its
    last-known state word and colour);
  - the strip lead and the full banner say `TELEMETRY STALE`.
- **A row that is not fresh** (state `OFFLINE` or `UNREADABLE`, or a stale snapshot) shows
  `SEEN <age>` under its state, and is left out of the power total.
- **Power.** `n` counts every GPU row (cached ones included), and `a` the rows that are
  fresh and have a finite power reading:
  - `<W> W NOW` when the snapshot is fresh and `a = n`;
  - `<W> W FROM a OF n GPUS` when `0 < a < n`;
  - `-- W` when `a = 0` or the snapshot is stale.

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
- **Status bar colour,** in this order:
  1. warn if the snapshot is stale;
  2. crit if any GPU is CRITICAL;
  3. warn if any GPU is HOT, THROTTLING, UNREADABLE or OFFLINE, or **the inventory warns**
     (below);
  4. otherwise the calm edge colour.
- **Incomplete inventory** comes from `gpu_hosts`, whatever the row count. It is the
  hosts whose outcome is `pending`, `offline` or `unreadable` and which have no rows.
  - Hosts with remembered GPUs always have rows, so this lists hosts whose GPUs (if any)
    chiketi has never seen.
  - These hosts get a footer note `NOT REACHED: <hosts>` (strip: in the lead after the
    counts). Host names are escaped, the list is cut to 3 names plus `+N`, and the line to
    the footer width.
  - **The inventory warns** (one predicate, used by both layouts and by the tab) when there
    are incomplete hosts and either there are no GPU rows at all, or one of the incomplete
    hosts is `unreadable` (it has `nvidia-smi` and the query failed, so it matters). An
    `offline` or `pending` host that chiketi has never seen a GPU on only gets the note.
    A house whose one GPU host is known therefore never warns because a GPU-less host is
    off.
- **Footer**, cut to fit: `N GPUS · B BUSY · <power> · CHECKED <age>`. Two notes may
  follow, when they apply:
  - `<hosts> NEED THE NEW PROBE` when there are NO DETAIL rows;
  - `NOT REACHED: <hosts>`.
- **Empty states:**
  - Home Lab pending: `ACQUIRING TELEMETRY`.
  - No GPU rows and some host `pending`, `offline` or `unreadable`:
    `GPU INVENTORY INCOMPLETE — <hosts>`, with a warn status bar.
  - Otherwise: `NO GPUS REPORTED`.

**Strip layout** (`bsStripFrame`):
- the lead is `N GPUS · B BUSY · H HOT` in the status colour (or `TELEMETRY STALE`);
- compact rows: `GPU i · name · host`, state, load %, VRAM %, temp, power;
- `+N MORE` on overflow.

**Tab attention** (`bsTabAttention`) for `gpus` follows the status bar's order:
- warn if the snapshot is stale;
- otherwise crit if any GPU is CRITICAL;
- otherwise warn on the status bar's warn conditions;
- otherwise none.

Every probe string (names, hosts, bus IDs) goes through `esc()`, and every layout size
through `gq()`.

## 4. Testing

**pytest:**
- **Parser:**
  - full version-2 output and version-1 output;
  - `[N/A]` fields, NaN and inf, a bad index, the wrong field count, more than 16 GPUs;
  - processes by bus id: a query that succeeds with none (0) and a query that fails (None);
  - `gpu_query=fail`.
- **The probe script**, using a test-only copy whose `PATH=` line is replaced by a
  controlled PATH: a directory of fakes, plus a directory of symlinks to the utilities the
  probe needs (found with `command -v` on the test machine), and nothing else. A real
  `nvidia-smi` can therefore never be found by accident. The test asserts that the
  production file's `PATH=` line is unchanged. There is also a case with `timeout` absent.
  With a fake `nvidia-smi`:
  - a normal sample;
  - the invalid-field retry;
  - a non-field failure (no retry; `gpu_query=fail|rc`);
  - a hang (cut off by `timeout`);
  - a failing process query;
  - output with one malformed line (`gpu_query=ok|2` with one `gpu=` line);
  - no `nvidia-smi` at all (`gpu_tool=absent`).

  The script runs under `dash` where installed (otherwise `sh`). Its output contains no
  process names or PIDs; the fake records its arguments and the test checks that only the
  two query forms were used. The existing `probe_version == 1` assertion becomes 2.
- **`gpu_state`:** every state, every threshold boundary, and the full cross-product of
  utilisation (None / 0 / 9 / 10) with processes (None / 0 / 1).
- **The single GPU condition** across poller cycles, through `IssueTracker`:
  - throttling turning into crit and back, with the issue never dropping;
  - oscillating across a threshold;
  - a partial (offline) cycle.
- **Poller snapshot:**
  - order;
  - offline and unreadable keep their rows and `seen_at`;
  - a removed card disappears only after a full `ok`;
  - a rejected line discards the whole sample: known GPUs go to `unreadable`; on first
    discovery the host is incomplete and the inventory warns;
  - version 1 going from temperatures to none (known GPUs: `unreadable`) and back;
  - `gpu_tool=absent` for a known GPU host (unreadable) and for a host without GPUs (none);
  - version-1 rows (`legacy`), through parser, poller and collector, before any probe is
    redeployed;
  - `pending` at start;
  - a restart during an outage, which shows the remembered rows as `offline`.
- **Alerts survive an unreadable query:** a raised GPU issue stays through `unreadable`
  cycles, while the same host's other issues clear. It clears normally after good `ok`
  polls, including when one of two GPUs was alerted and both now read healthy.
- **Slow polls:** with a fake clock, a 10 s poll, 30 s collections and 12 hosts (two
  batches), the published snapshot is never stale between two consecutive publications,
  including just before the second one. A poller that stops publishing is stale after
  `stale_after`.
- **Collector:** the metrics.

**Harness:**
- `FULL` gains `homelab.gpus` and `homelab.gpu_hosts`.
- New fixtures:
  - `GPU_HOUSE`: one of each state;
  - `GPU_HOUSE_NONE`;
  - `GPU_HOUSE_INCOMPLETE`;
  - `GPU_HOUSE_STALE` (with a cached CRITICAL row: warn chrome, CRITICAL word kept);
  - `GPU_HOUSE_MIXED_POWER` (fresh rows with and without power, plus an offline row:
    `FROM a OF n`), and `GPU_HOUSE_ONE_OFFLINE` (one fresh 100 W GPU and one offline GPU:
    `100 W FROM 1 OF 2 GPUS`, never `W NOW`);
  - `GPU_HOUSE_INCOMPLETE_WITH_ROWS` (a healthy GPU host and a never-reached host, with a
    long hostile name);
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
