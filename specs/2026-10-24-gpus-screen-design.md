# GPUs: a Kiosk screen for every GPU in the house

Status: written 2026-10-24 while Rohan was away ("just keep going"); the choices marked
**[parked]** are his to confirm. Builds on `specs/2026-10-23-screen-modes-design.md`.

## Why

Rohan wants one place that shows every GPU in the house and what state it is in: which
are working, which are idle, which are hot or throttling, which machine has gone away.
Today the house's GPUs are visible only on the machine itself (the Self GPU screen), and
Home Lab raises an issue only when a GPU is too hot. GPUs is the first Kiosk screen to be
built after Home Lab and Sessions; its tab already exists, grey.

Success: on the Go and the LCD, the GPUs tab lights up and shows each GPU (today: the
Tesla V100s in the house GPU workstation) with its load, memory, temperature, power and a one-word state,
worst first, without anyone opening a terminal.

## Scope

In: NVIDIA GPUs on the hosts Home Lab already probes (`homelab.toml`, kinds `linux` and
`unraid`); a full and a strip layout in Sci-Fi/TOS and Others/Claude; the tab's
attention colour; one new Home Lab issue (GPU throttling).

Out: AMD/Intel GPUs on remote hosts (none in the house; the probe can grow them later);
per-process names (privacy and payload: only a count); history graphs; the server's own
local GPU (see decision 1).

## Decisions

1. **[parked] Data comes only from the Home Lab probe**, not from chiketi's local GPU
   collector. Every GPU host is already a Home Lab host, the server itself is probed too
   (a server is often listed as `127.0.0.1` in `homelab.toml`), so using both would list a server's GPUs
   twice. A house without Home Lab has no GPUs screen (the screen `needs: "homelab"`).
2. **[parked] A row per GPU, like Sessions**, rather than the Self GPU screen's dials: the
   point is a house-wide summary that reads across a room and fits the 1920×462 LCD.
3. **[parked] The states and their words** (first match wins):
   `OFFLINE` — the host did not answer this poll (its last readings stay, dimmed);
   `CRITICAL` — temperature ≥ `gpu_crit_c` (92 °C default);
   `HOT` — temperature ≥ `gpu_warn_c` (85 °C default);
   `THROTTLING` — the driver reports a thermal or hardware slowdown (clock event bits
   0x08 HW slowdown, 0x20 SW thermal, 0x40 HW thermal, 0x80 HW power brake; the
   ordinary 0x04 "SW power cap" under load is not throttling);
   `BUSY` — utilisation ≥ 10 % or at least one compute process;
   `IDLE` — otherwise;
   `NO DETAIL` — the host runs an old probe that reports only a temperature.
4. **[parked] Existing displays are not changed.** New Kiosk displays get
   `["lab", "sessions", "gpus"]`; the Go and the LCD keep their screens until GPUs is
   ticked in the control panel.
5. **[parked] The probe must be redeployed** to the GPU hosts (`chiketi-site deploy probe <host>`) for anything beyond temperatures. Until then such a
   host shows `NO DETAIL` rows.

## 1. The probe (`assets/probe/chiketi-probe`, version 2)

Still read-only, still no arguments. `probe_version=2`. The existing `gpu_temp_c=` lines
stay (an older chiketi reads them). New lines, one per NVIDIA GPU:

```
gpu=<index>|<name>|<util %>|<memory used MiB>|<memory total MiB>|<temp °C>|<power W>|<power limit W>|<fan %>|<clock event reasons hex>|<pci bus id>
gpu_procs=<pci bus id>|<count>
```

- From `nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,
  temperature.gpu,power.draw,power.limit,fan.speed,clocks_event_reasons.active,pci.bus_id
  --format=csv,noheader,nounits`. If that exits non-zero (drivers older than the
  `clocks_event_reasons` name), the same query with `clocks_throttle_reasons.active`.
- Fields split on `, `; `[N/A]`, `[Not Supported]` and anything non-numeric in a numeric
  field become empty; `|` and `=` are stripped from the name and bus id; the name is cut
  to 40 characters.
- `gpu_procs` from `nvidia-smi --query-compute-apps=gpu_bus_id --format=csv,noheader`,
  counted per bus id. Process names and PIDs are never printed.
- Every `nvidia-smi` call is bounded with `timeout 10` where `timeout` exists, so a hung
  driver cannot hold the probe (the poller's own 20 s limit stays the backstop).

## 2. Parsing and state (`collectors/homelab/`)

- `probe.py`: a `Gpu` dataclass (index, name, util, vram_used, vram_total, temp, power,
  power_limit, fan, throttle (int or None), bus_id, procs) and `ProbeReport.gpus`. A
  `gpu=` line with a missing or non-integer index is dropped; numeric fields that do not
  parse are None. `gpu_procs` attaches by bus id. At most 16 GPUs per host.
- `rules.py`: `gpu_state(gpu, thresholds, offline) -> str` implementing decision 3, and a
  new condition `gpu_throttle:<index>` (warn, "GPU <i> throttling", hold like temperature
  conditions) when the throttle bits of decision 3 are set and the GPU is not already
  HOT/CRITICAL (no double report).
- `poller.py`: keeps each host's last GPU list. After each poll the snapshot gains
  `"gpus"`: for every linux/unraid host, in `homelab.toml` order, its GPUs in index order,
  each `{host, index, name, util, vram_used, vram_total, temp, power, power_limit, fan,
  procs, state, detail}` where `detail` is false for temperature-only (old probe) rows.
  A host whose probe failed keeps its previous GPUs with state `offline`; a host never
  reached has none. A host whose probe answers with no GPU lines has none (its card was
  removed: rows do not linger).
- `collector.py`: `homelab.gpus` (the list; available once the first poll finished) with
  `extra = {"warn_c", "crit_c"}` from the thresholds.

## 3. The screen

`screens.json`: `gpus` becomes `built: true`, `needs: "homelab"`; Kiosk defaults become
`["lab", "sessions", "gpus"]`. `KIOSK_RENDERERS` gains `gpus: sfTosGpus` (TOS) and
`claudeGpus` (Claude), wrappers over `bsGpusScreen(c)`.

**Full layout** (Sessions' frame: status bar, `bsHeader('gpus')`, body, footer):
- Columns: mark (a small GPU glyph in the state colour), GPU name over host, STATE, LOAD
  (segmented bar + %), VRAM (bar + `used / total G`, one decimal on used), TEMP
  (thermal colour), POWER (`W / limit W`), PROCS.
- Order: CRITICAL, HOT, THROTTLING, OFFLINE, NO DETAIL, BUSY, IDLE; within a state, host
  order then index.
- Rows grow up to 1.25× when few, as Sessions does; overflow shows `+N MORE`.
- Status bar colour: crit if any CRITICAL; warn if any HOT, THROTTLING or OFFLINE; else
  the calm edge colour.
- Footer: `N GPUS · B BUSY · W W TOTAL · CHECKED <age>`; if any row is `NO DETAIL`:
  `<hosts> NEED THE NEW PROBE FOR DETAIL`.
- Empty and edge states, each saying why: Home Lab pending → `ACQUIRING TELEMETRY`;
  no GPU anywhere → `NO GPUS REPORTED`; (unconfigured never shows: the screen needs
  Home Lab).

**Strip layout** (`bsStripFrame`): lead `N GPUS · B BUSY · H HOT` in the status colour;
compact rows (name·host, state, load %, VRAM %, temp, power); `+N MORE`.

**Tab attention** (`bsTabAttention`): `gpus` crit if any CRITICAL, warn if any HOT,
THROTTLING or OFFLINE.

Every string from the probe (names, hosts) goes through `esc()`; layout sizes use `gq()`.

## 4. Testing

- pytest: probe parser (full v2 output, v1 output, `[N/A]` fields, hostile names, bad
  index, >16 GPUs, procs by bus id); the probe script itself against a fake
  `nvidia-smi` on PATH (both query names, a failing first query, hung call bounded by
  `timeout`, no process names in output); `gpu_state` for every state and boundary;
  throttle condition and no double report; poller snapshot (order, offline keeps last
  readings, removed card disappears, old-probe rows); collector metric.
- Harness fixtures: `FULL` gains `homelab.gpus`; `GPU_HOUSE` (one of each state),
  `GPU_HOUSE_NONE`, `GPU_HOUSE_MANY` (overflow), `GPU_HOUSE_HOSTILE`; checks: rows
  ordered worst first, every state word present, `+N MORE`, no unescaped name, layout px,
  strip and full at all shapes; the plan checks gain `gpus` in the ready set.
- `fit_check`: `gpus:FULL`, `gpus:GPU_HOUSE`, `gpus:GPU_HOUSE_MANY` at 1800×1200 and
  1920×462.
- `devices_check`: unchanged except new Kiosk defaults (`lab,sessions,gpus`).

## 5. Rollout

Branch `gpus-screen` → plan, Codex until approved → build → Codex until approved →
`chiketi-site deploy server --dry-run` → Rohan's OK → deploy server, then (his OK)
`chiketi-site deploy probe <host>` for each GPU host → tick GPUs on the displays.
