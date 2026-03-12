# Chiketi - System Stats Dashboard Blueprint

## What Is This

A terminal/hacker-aesthetic system monitoring dashboard built for a dedicated 7" GeeekPi display (1024x600, PCB800099-V.9 controller) connected via HDMI to an Ubuntu workstation. The dashboard cycles between two screens showing real-time system and AI performance stats.

**Target hardware:**
- Display: GeeekPi 7" 1024x600 on HDMI-A-1
- Host: Ubuntu Linux, i9-12900K, RTX 3090 Ti, 64GB RAM
- The display acts as a standard HDMI monitor — no special drivers needed

**Multi-monitor setup:**
- HDMI → GeeekPi (dedicated dashboard, fullscreen)
- DisplayPort → primary monitor (desktop, terminals, normal use)
- The dashboard auto-detects the 1024x600 screen and targets it, leaving the primary display untouched

## Project Structure

```
chiketi/
├── pyproject.toml
├── chiketi/
│   ├── __init__.py
│   ├── __main__.py              # CLI: python -m chiketi
│   ├── app.py                   # pygame main loop, MetricEngine thread, run()
│   ├── config.py                # All constants: colors, fonts, timing, thresholds
│   ├── themes.py                # Theme definitions and active theme management
│   ├── server.py                # HTTP control panel (localhost:7777)
│   ├── collectors/
│   │   ├── base.py              # MetricCollector ABC + MetricValue dataclass
│   │   ├── registry.py          # Platform-aware collector list
│   │   ├── system.py            # Hostname + uptime (psutil)
│   │   ├── cpu.py               # Temp, usage, per-core, fan (psutil + sensors)
│   │   ├── memory.py            # RAM + Swap (psutil)
│   │   ├── disk.py              # / and /home usage (psutil)
│   │   ├── network.py           # Throughput, delta-based (psutil)
│   │   ├── gpu_nvidia.py        # Full GPU stats (pynvml)
│   │   └── llama_cpp.py         # llama.cpp server detection + health
│   ├── screens/
│   │   ├── base.py              # BaseScreen with metric helpers
│   │   ├── system_stats.py      # Screen 1: full system overview
│   │   └── ai_monitor.py        # Screen 2: GPU/AI performance
│   └── widgets/
│       ├── panel.py             # Box-drawn panel container (surface renderer)
│       ├── progress_bar.py      # [████░░░░] block-character bar (surface renderer)
│       ├── metric_row.py        # Label + optional bar + value (surface renderer)
│       └── process_table.py     # CUDA process list table (surface renderer)
└── scripts/
    ├── run.sh                   # Launch script (activates venv)
    └── chiketi.desktop          # Autostart .desktop file
```

## Dependencies (3 only)

```toml
dependencies = [
    "pygame-ce>=2.4",        # pygame Community Edition — rendering
    "psutil>=5.9",            # CPU, memory, disk, network, process info
    "nvidia-ml-py>=12.0",    # NVIDIA GPU stats via NVML
]
```

## Data Flow

```
MetricEngine (threading.Thread, 1500ms interval)
  → collect from all registered collectors
      → SystemCollector.collect()     → {"sys.hostname": MetricValue, ...}
      → CpuCollector.collect()        → {"cpu.temp": MetricValue, ...}
      → MemoryCollector.collect()     → {"mem.ram_used": MetricValue, ...}
      → DiskCollector.collect()       → {"disk.root_used": MetricValue, ...}
      → NetworkCollector.collect()    → {"net.dl": MetricValue, ...}
      → GpuNvidiaCollector.collect()  → {"gpu.temp": MetricValue, ...}
      → LlamaCppCollector.collect()   → {"llama.status": MetricValue, ...}
  → self._latest = data  (thread-safe dict replacement under GIL)
  → main loop reads engine.get_latest() each frame
      → screens[current_idx].render(surface, data, fonts)
      → pygame.display.flip()
```

The active screen is rendered every frame (30 FPS). Metrics are always current when switching screens.

## Collector Design

Every collector inherits from `MetricCollector` and returns `dict[str, MetricValue]`.

**MetricValue** carries:
- `value` — the reading (any type)
- `unit` — display unit string ("°C", "%", "MiB", etc.)
- `available` — False if the metric couldn't be read
- `extra` — additional context (totals, limits, raw values)

**Key rules:**
- Collectors never raise exceptions — they catch internally and set `available=False`
- Collector failures are logged to stderr for diagnostics
- Metric keys use `namespace.name` format (e.g., `gpu.vram_used`)
- The registry returns all collectors; unavailable hardware gracefully degrades

### Metric Keys Reference

| Collector | Keys | Notes |
|-----------|------|-------|
| SystemCollector | `sys.hostname`, `sys.uptime` | Uptime formatted as "Xd Xh Xm" |
| CpuCollector | `cpu.usage`, `cpu.per_core`, `cpu.temp`, `cpu.fan` | Temp via coretemp/k10temp sensors |
| MemoryCollector | `mem.ram_used`, `mem.ram_total`, `mem.ram_percent`, `mem.swap_*` | Values in GiB |
| DiskCollector | `disk.root_used`, `disk.root_total`, `disk.root_percent`, `disk.home_*` | Auto TiB/GiB |
| NetworkCollector | `net.dl`, `net.ul` | Delta-based, auto-scales B/KB/MB per sec |
| GpuNvidiaCollector | `gpu.name`, `gpu.temp`, `gpu.fan`, `gpu.power`, `gpu.vram_*`, `gpu.util`, `gpu.mem_util`, `gpu.clock_gpu`, `gpu.clock_mem`, `gpu.processes` | processes is list of dicts |
| LlamaCppCollector | `llama.status`, `llama.health`, `llama.model` | HTTP to localhost:8080 |

## Rendering Architecture

All rendering uses pygame surfaces — no Qt widgets.

| Layer | Implementation |
|-------|---------------|
| Main loop | `pygame` event loop + `clock.tick(30)` |
| MetricEngine | `threading.Thread` + shared `dict` |
| Display | `pygame.display.set_mode()` + display index for multi-monitor |
| Screens | Classes with `render(surface, data, fonts)` method |
| Widgets | Pure classes/functions drawing to surfaces via `font.render()` and `pygame.draw` |
| Theme polling | Compare theme name string each frame |
| Font rendering | `pygame.font.Font` (DejaVu Sans Mono TTF) |

## Screen Layouts

### Screen 1: System Stats

Two-column layout. Left: CPU, Memory, Network. Right: GPU, Disk, System.

```
┌──[ CPU ]──────────────┐ ┌──[ GPU ]──────────────┐
│ Temp: 52°C            │ │ Temp: 45°C  Fan: 0%   │
│ Load: [████████░░] 78%│ │ Power: 26W / 450W     │
│ Fan: N/A              │ │ VRAM: [██████░░] 18/24G│
│ Cores: 80 45 92 ...   │ │ Util: [████░░░░░░] 42%│
├──[ MEMORY ]───────────┤ ├──[ DISK ]─────────────┤
│ RAM:  [████░░░░] 12/64│ │ /     [█░░░░░] 0.04/1T│
│ Swap: [░░░░░░░░]  0/8 │ │ /home [█░░░░░] 0.04/1T│
├──[ NETWORK ]──────────┤ ├──[ SYSTEM ]───────────┤
│ ↓ 12.5 MB/s           │ │ Host: mycroft         │
│ ↑  1.2 MB/s           │ │ Up: 18d 5h 16m        │
└───────────────────────┘ └───────────────────────┘
```

### Screen 2: AI Monitor

Single-column, vertically stacked. Detailed GPU stats, CUDA process table, llama.cpp status.

```
┌──[ GPU PERFORMANCE ]──── NVIDIA GeForce RTX 3090 Ti ──┐
│ Utilization: [█████████░░░] 85%                        │
│ VRAM:        [██████████████░░░░] 22146/24564 MiB      │
│ Temperature: 45°C      Power: 26W / 450W               │
│ GPU Clock: 210/2115 MHz  Mem: 405/10501 MHz            │
│ Mem BW Util: [███████░░░░] 72%                         │
├──[ CUDA PROCESSES ]────────────────────────────────────┤
│ PID     Name                        VRAM               │
│ 62692   llama-server                22130 MiB           │
├──[ LLAMA.CPP ]─────────────────────────────────────────┤
│ Status: Running (ok)                                    │
│ Model: qwen2.5-coder-32b                               │
└────────────────────────────────────────────────────────┘
```

## Visual Style

| Element | Value |
|---------|-------|
| Background | `#0a0a0a` |
| Panel background | `#111111` |
| Panel border | `#333333`, 1px solid |
| Primary text | `#00ff41` (green) |
| Warning text | `#ffb000` (amber) — 70-90% usage |
| Critical text | `#ff3333` (red) — >90% usage |
| Dimmed/unavailable | `#555555` |
| Font | DejaVu Sans Mono |
| Body size | 14px (11pt + 3) |
| Header size | 16px (14pt + 2), bold |
| Progress bar | `[████░░░░]` — █ filled, ░ empty |
| Panel titles | `──[ TITLE ]` format |

## Themes

Six built-in themes switchable via HTTP control panel at `http://localhost:7777`:

| Theme | Primary | Accent |
|-------|---------|--------|
| hacker | `#00ff41` green | `#ffb000` amber |
| cyan | `#00e5ff` cyan | `#ffb000` amber |
| amber | `#ffb000` amber | `#ff6600` orange |
| phosphor | `#33ff33` green | `#aaff00` yellow-green |
| red_alert | `#ff4444` red | `#ff8800` orange |
| blue | `#4488ff` blue | `#ffb000` amber |

## Navigation

| Input | Action |
|-------|--------|
| Auto | Rotate screens every 10s (configurable, minimum 1s) |
| `1` / `2` | Jump to screen 1 or 2, pause rotation 30s |
| Space / ← / → / Tab | Toggle to next screen, pause rotation 30s |
| Escape / F11 | Exit |

## Multi-Monitor Screen Targeting

When running fullscreen (default), the window targets the GeeekPi display via pygame display index:

1. If `--screen NAME` given → substring match against display names (case-insensitive)
2. Else → find the 1024x600 display (GeeekPi signature resolution)
3. Else → use first non-primary display
4. Else → use default (only one display connected)

Fullscreen mode uses `pygame.FULLSCREEN | pygame.NOFRAME` with hidden mouse cursor.

## CLI

```
python -m chiketi [OPTIONS]

  --windowed              Run in 1024x600 window instead of fullscreen
  --rotate-interval INT   Seconds between screen rotation (default: 10, min: 1)
  --screen NAME           Target screen by name substring (e.g., "HDMI")
```

## Timing

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Frame rate | 30 FPS | Main loop cap (dashboard doesn't need 60fps) |
| Collection interval | 1500ms | How often metrics are gathered |
| Rotation interval | 10s | How often screens auto-switch |
| Pause duration | 30s | How long key press pauses rotation |

## Key Decisions

1. **pygame-ce over Qt** — Pixel-level rendering control for future VFD and nixie tube display themes. No widget toolkit overhead. pygame Community Edition is well-maintained and compatible.

2. **3 dependencies only** — pygame-ce for rendering, psutil for system metrics, nvidia-ml-py for GPU. llama.cpp monitoring uses stdlib urllib. Minimal surface area.

3. **Thread-safe metrics** — MetricEngine runs in a daemon thread, replacing `self._latest` dict atomically (safe under GIL). Main loop reads it each frame with no locking needed.

4. **Collectors never raise** — Each collector catches its own exceptions and returns `available=False`. Failures are logged to stderr. One failing collector (e.g., GPU removed) doesn't break others.

5. **Delta-based network** — NetworkCollector tracks previous byte counts and timestamps. First reading returns 0, subsequent readings compute actual throughput.

6. **NVML lazy init** — GPU library initialized once on first collection, not at import time. Allows graceful degradation if no NVIDIA GPU present.

7. **Auto-detect display by resolution** — The GeeekPi's 1024x600 is unusual enough to be a reliable fingerprint. Falls back to `--screen` flag for edge cases.

8. **Pause-on-interaction** — Any keypress pauses auto-rotation for 30s via monotonic timestamp comparison. Simple, no state machine needed.

9. **Namespace.key metrics** — Flat dict with dotted keys (`gpu.vram_used`) instead of nested dicts. Simpler to pass around, easier to look up.

10. **TiB/GiB auto-scaling for disk** — Disks >= 1 TiB show in TiB, smaller in GiB. Matches the actual hardware (1.79 TiB drive).

11. **Localhost-only control server** — HTTP control panel binds to `127.0.0.1:7777` (not `0.0.0.0`) to avoid exposing theme-change API to the network.

## Cross-Platform Strategy

Currently Linux-only. Platform-specific parts are isolated:

- **CPU temp/fan**: psutil sensors (Linux). Future: add `cpu_windows.py`, `cpu_macos.py`
- **GPU**: pynvml works on Linux and Windows. Future: add `gpu_apple.py` for Metal
- **Everything else**: psutil is cross-platform (CPU usage, memory, disk, network)

## Running

```bash
# Development (windowed on your main monitor)
python -m chiketi --windowed

# Production (fullscreen on GeeekPi)
python -m chiketi

# Force to HDMI output
python -m chiketi --screen HDMI

# Detached (survives terminal close)
nohup ./scripts/run.sh &

# Autostart on login
ln -s ~/projects/chiketi/scripts/chiketi.desktop ~/.config/autostart/
```
