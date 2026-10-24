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
  limited to 5 s, and the process query to 4 s. A call that ignores TERM is killed one second later (`timeout -k 1`), so the GPU part takes at most 17 s. Where it
  does not, there is no per-call bound, and the poller's SSH limit is the only one.
  - That limit (`run_probe`) rises from 20 s to 30 s.
  - A poll finishes after all hosts have been checked, with at most eight checks running at
    once, and the next poll starts `poll_seconds` after it finishes. §3's staleness allowance is built from
    that schedule.

## 2. Parsing, state and alerts (`collectors/homelab/`)

**`probe.py`**
- New fields: `ProbeReport.gpu_query` (`"ok"`, `"fail"`, `"legacy"` for a version-1
  probe, or `None` when there was no query)
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
- `IssueTracker.update()` gains `keep=None`, a predicate on condition keys. A key it
  accepts that the update does not mention is left exactly as it was, as for a partial
  update. Every other key clears normally. The poller passes:
  - for an `unreadable` host: every `gpu_temp:` key (no GPU there has fresh evidence);
  - for an `ok` or `legacy` host: exactly the keys `gpu_temp:<i>` of the GPUs whose
    reading lacks what recovery needs. That is a missing temperature, or (version 2) a
    missing throttle mask.

  So a raised GPU alert is cleared only by a reading that shows it is over. It is never
  cleared by an `N/A`, or by a failed query. Other GPUs, and the host's filesystem and memory
  issues, clear normally. Cached readings are never evaluated again as new evidence.
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
    fresh evidence, preserving all its `gpu_temp:` keys (the `keep` predicate) is exact.
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
- **Staleness** is judged on `homelab.gpus`' own `extra.published_at` and
  `extra.stale_after` (seconds).
  - `published_at` is stamped by `poll_once()` when it publishes the snapshot (the poll
    *finished*). The collector copies it unchanged, so repeated `collect()` calls on a frozen
    snapshot never make it look newer.
  - `stale_after = 2 × (1.1 × poll_seconds + ceil(hosts / 8) × 40)` is a conservative
    allowance, not an exact bound. It is two cycles, with the 10 % jitter, and 40 s per batch
    of eight hosts: the 30 s SSH limit plus a backup-API fetch.
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
  - `<W> W NOW` when the snapshot is fresh and `a = n > 0`;
  - `<W> W FROM a OF n GPUS` when `0 < a < n`;
  - `-- W` when `a = 0` (including no GPUs at all) or the snapshot is stale.

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
- **Alerts survive missing fields:** a raised heat alert stays while that GPU's temperature
  reads `N/A`, and a throttling alert stays while its mask reads `N/A`. Each clears after a
  real healthy reading, while a second GPU's alert clears on its own good readings.
- **`published_at`:** repeated `collect()` calls on a frozen snapshot return the same
  value.
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

## 6. Amendment: what a real V100 showed (2026-10-24)

The v2 probe, run by hand on a host with one V100-PCIE-32GB under full load, parsed correctly.
Two things change as a result, both chosen by Rohan. Heat is still judged on the core
temperature only. Where this section disagrees with §§1–4, this section wins.

**Finding:**
- `clocks_event_reasons.active` alternated between `0x0` and `0x20` (software thermal
  slowdown) on successive manual samples two seconds apart.
- The core read 69 °C while the HBM memory read 84–85 °C.

What production polling (every `poll_seconds`) will see is not known. If it sees the same
alternation, the row as built flips between BUSY and THROTTLING on every poll. The alert,
which needs `HOLD_TEMP` (4) slowdowns in a row, never fires. Both are misleading: the row
flickers, and a card that slows itself down half the time says nothing.

**6.1 Throttle evidence (`poller.py`)**
- **The history:** for each `(host, GPU index)`, the poller keeps the last 4 throttle
  readings, newest last. Each reading is `(poll time, slowed: bool)`.
  - The poll time is the poller's monotonic clock (`mono`), so a wall-clock change can
    neither extend nor cut the age limit.
  - The history also stores the card's identity: its UUID (§6.4), or its bus id when the
    UUID is empty, or its name when both are.
  - With the UUID, a replaced card is always told apart. Without it (an older v2 probe, or
    a driver that does not report it), a card swapped into the same slot can inherit up to
    3 polls of evidence for as long as that evidence is unexpired. That is a documented
    limitation.
- **What adds a reading:** only a v2 `ok` sample whose GPU has a throttle mask.
- **What leaves the history as it was:**
  - a missing mask (`N/A`);
  - an `unreadable` or `offline` host;
  - a remembered or cached reading.
- **What drops a GPU's history:**
  - an `ok` sample without that index;
  - an `ok` sample at that index with a different identity (a swapped or renumbered card),
    before its reading is added;
  - a `legacy` (v1) sample, which can say nothing about throttling;
  - an outcome of `none`.
- **The age limit:** a reading older than `4 × cycle` is ignored, where
  `cycle = 1.1 × poll_seconds + ceil(hosts / 8) × 40`. That is twice §3's `stale_after`,
  about four polls. Old evidence never counts.
- The history is memory-only: a restart starts it empty, and baselines are unchanged.

From the current, non-expired readings:
- **recent** = any of the last 3 readings slowed;
- **qualifies** = at least 3 of the last 4 readings slowed.

**6.2 The row** (`gpu_state(g, thr, outcome, throttled=None)`)
- The THROTTLING test uses `throttled` when it is given, and the sample alone when it is
  `None`, as before.
- The poller passes `recent` when the history has a non-expired reading, and `None`
  otherwise. So right after a restart, or with only expired readings, it judges the sample
  alone. A sample without a mask then shows its BUSY/IDLE/UNKNOWN state, as before.
- The bits that count (0x08, 0x20, 0x40, 0x80) and the order of states are unchanged.

**6.3 The alert** (`gpu_condition(g, thr, throttled=None, fast=False)`)
- There is one condition per GPU, under the same key `gpu_temp:<i>` as before.
- **Its title and severity:**
  - from heat if the core temperature is warn or crit (as before);
  - otherwise warn `GPU <i> throttling`, when `throttled` is true;
  - otherwise there is no condition.
- **Its hold** is 1 when `fast` is true, and `HOLD_TEMP` otherwise. So whether throttling
  qualifies is decided independently of which title wins: three slowdowns raise the alert
  at once, even if the third sample is also hot.
- **What the poller passes:**
  - `throttled = qualifies or (raised and recent)`;
  - `fast = throttled`;
  - `raised` means the tracker already holds a raised `gpu_temp:<i>` for that host. A new
    `IssueTracker.raised(host, key) -> Condition | None` answers it.
  - Once raised, the alert therefore stays for as long as the row says THROTTLING. That is
    the hysteresis.
  - Heat that recovers while the row still says THROTTLING hands over to the throttle
    title without dropping the alert, which keeps §2's guarantee.
- **Who builds the conditions:**
  - the poller replaces the `gpu_temp:` conditions from `evaluate_report` with its own, for
    `ok` and `legacy` samples;
  - for a legacy sample without unresolved throttling, it passes `throttled=False` and
    `fast=False`: heat only, as before;
  - `throttled=None` (the default) keeps the old per-sample rule for any other caller.
- **Unresolved throttling:** the poller keeps a flag per `(host, index)`.
  - It is set when a poll passes `throttled=True` and the key is raised after that update,
    whichever title won.
  - It is cleared only when the tracker no longer holds that key at all, that is, once
    recovery has completed. It is also dropped with the GPU's history on a missing index,
    an identity change, or `none`. A legacy sample does not drop it.
  - While it is set, a sample that cannot show the throttling is over (a legacy sample, or a
    v2 sample without a mask) passes `throttled=True, fast=True`. That puts the condition
    back, so a recovery under way starts again. Only consecutive v2 readings that show it
    is over (`CLEAR_AFTER` of them) can clear it. The alert stays, with
    heat's title when hot and the throttling title otherwise, until a v2 reading clears it.
    This keeps §2's rule that only a reading showing the problem is over clears it,
    whatever title the alert had in between.
  - Keep-keys (§2) are otherwise unchanged.
- Swapping a card does not move its open issue. That is out of scope, as before.

**Traces** (1 = slowed; one reading per poll, none expired, starting from no history and
no issue). The core stays below warn unless a step says hot, and the card is under load
(util ≥ 10 %), so a sample that is not throttling reads BUSY:
- **`0,1,0,1,0,1,…`**:
  - row: BUSY at poll 1, THROTTLING from poll 2 on;
  - alert: never (2 of 4 at most).
- **`1,1,1`**:
  - row: THROTTLING from poll 1;
  - alert raised at poll 3.
- **`1,1,1,1` then `0,0,0,0,…`** (no heat): the alert is raised at poll 3, and then:

  | Reading | Last 3 | Recent | Row | Condition | Tracker |
  |---|---|---|---|---|---|
  | 1st 0 | 1,1,0 | yes | THROTTLING | present | stays raised |
  | 2nd 0 | 1,0,0 | yes | THROTTLING | present | stays raised |
  | 3rd 0 | 0,0,0 | no | BUSY | absent | good 1 |
  | 4th 0 | 0,0,0 | no | BUSY | absent | good 2: cleared |
- **`1,1` then a hot sample with slowdown:** raised at poll 3, as hot (heat's title, hold 1).
- **Hot ×4 (alert raised), then cool with `1,0,1,0`:** the condition continues as
  throttling while the readings stay recent. It clears only after the row stops saying
  THROTTLING, plus `CLEAR_AFTER`.
- **Missing masks for longer than the age limit:** the history expires, and the row
  judges the sample alone.
- **`1,1,1`, then one hot legacy sample, then cool legacy samples:**
  - the alert is raised at poll 3;
  - it shows heat's title on the hot sample, then the throttling title;
  - it stays until a v2 sample with a mask reads 0 and the row stops saying THROTTLING,
    plus `CLEAR_AFTER`.
- **`1,1,` then a hot sample with slowdown, then cool legacy samples:** the same; it is
  never cleared by the legacy samples.
- **Interrupted recovery: `1,1,1`, legacy, v2 `0`, legacy, v2 `0`, v2 `0`:**
  - raised at poll 3;
  - kept by the first legacy sample;
  - good 1 at the first v2 `0` (the history was dropped, so it is not recent);
  - the second legacy sample restarts it;
  - good 1, then good 2 on the last two `0` samples: cleared, and the flag is cleared.
- **An offline or unreadable poll in the middle of a recovery** freezes it rather than
  restarting it (§2's partial update and keep-keys): `good 1`, offline, a v2 `0` clears.
  Only a legacy or no-mask sample *restarts* it.

**6.4 Memory temperature (probe, parser, screen)**
- **The UUID:**
  - The detailed query gains `uuid` as a twelfth field. The UUID has been in `nvidia-smi`
    for as long as the rest of the list, so the query's compatibility does not change.
  - `gpu=` lines have 12 fields. The last is the UUID, with `|`, `=` and spaces stripped, cut
    to 64 characters, and empty if it is missing.
  - The parser accepts 11 fields (an earlier v2 probe; no UUID) or 12. Any other count is
    dropped, as before.
  - `Gpu.uuid` is a string. It is remembered in the baseline and validated as a string, but
    is not in the snapshot rows or on the screen.
- **The probe:**
  - When the detailed query succeeded, it runs one more query as **the probe's very last
    step**, after SMART, systemd, apt and Unraid:
    `nvidia-smi --query-gpu=pci.bus_id,temperature.memory --format=csv,noheader,nounits`.
  - Each line with an integer-like temperature prints `gpu_mem_temp=<bus id>|<°C>`.
  - A failure, or `N/A` on cards without a memory sensor, prints nothing.
  - It is a separate, optional query, so a driver that does not know the field cannot
    break the main sample.
- **Its budget:**
  - The query runs only where `timeout` exists, so no unbounded call is added. It is limited
    to 3 s, with KILL 1 s later.
  - It runs only if the probe has been running for 0–19 s at that point, by the monotonic
    clock: the integer seconds of `/proc/uptime`, read at the probe's start and at that
    point. A wall-clock change cannot move it. An unreadable or non-numeric
    `/proc/uptime`, or a negative difference, skips the query.
  - Since nothing follows it, the probe ends by 20 + 4 = 24 s after its start. That leaves
    6 s of the 30 s SSH limit for connecting and starting. This is a conservative reserve,
    not a proven bound: `run_probe()` does not separately bound SSH startup. A host whose
    connection takes more than 6 s already risks the limit today.
  - A probe that already takes 20 s or more without it is unaffected: the query is
    skipped, and nothing is added.
  - Hosts without `timeout`, and slow hosts, simply show no memory temperature.
  - §1's "at most 17 s" for the GPU part is unchanged, because this query is budgeted
    separately at the end. There are now three query forms: the detailed one with its one
    retry, the process query, and this one.
- **The parser:**
  - `Gpu.mem_temp` (float or None) is matched by bus id, as the process counts are.
  - A value outside −50…200 °C, a non-finite value, or no line gives None.
- **The baseline** remembers `mem_temp` and validates it like the other floats. An older
  baseline file without it loads with None.
- **The snapshot row** gains `mem_temp`.
- **The screen:**
  - In the full layout, the TEMP cell keeps the core temperature as its main line. Under
    it, a smaller line reads `MEM <t>°`, with `t` rounded to an integer, when the display
    has a finite `mem_temp` within −50…200; otherwise there is no second line, never
    `MEM --`.
  - The cell keeps its fixed width and is never cut short (`data-fit`, checked by
    fit_check).
  - The strip layout is unchanged (core only).
- **Not judged:** the memory temperature raises no state and no alert. Memory heat limits
  differ between cards; that is a later decision.

**6.5 Testing**
- **Probe script (PATH fakes):**
  - `gpu_mem_temp` lines are printed;
  - `N/A` prints nothing;
  - a failing memory query leaves the main sample and the process counts intact;
  - no `timeout` means no memory query;
  - the uptime file is injectable (`CHIKETI_PROBE_UPTIME`, tests only; the forced command
    runs with a fixed environment):
    - 19 s elapsed runs the query;
    - 20 s skips it;
    - a negative difference skips it;
    - an unreadable or non-numeric file skips it;
  - the query's lines come after every other probe line;
  - the 12-field `gpu=` line carries the UUID, and an 11-field line still parses.
- **Parser:**
  - `mem_temp` is matched by bus id;
  - absent gives None;
  - non-finite or out-of-range values give None.
- **Poller and rules:** every trace in §6.3, plus:
  - a missing mask leaves the history alone;
  - an unreadable host leaves it alone;
  - expiry by age;
  - an index that disappears drops its history;
  - an identity change resets it: by UUID, by bus id when there is no UUID, and by name
    last;
  - age is measured on the monotonic clock: a fake wall clock jumping back does not extend
    it;
  - unresolved throttling survives legacy samples, including a heat title in between, and
    is cleared only by a v2 reading of 0;
  - the interrupted-recovery trace;
  - a legacy sample drops the history;
  - an empty history judges the sample;
  - `throttled=None` keeps the old behaviour.
- **Baseline:** `mem_temp` round-trips; an old file without it loads.
- **Screen:**
  - harness fixtures with and without `mem_temp`, plus hostile and out-of-range values;
  - fit_check at 1800×1200, 1920×462 and 1024×600 with `MEM` lines present.
