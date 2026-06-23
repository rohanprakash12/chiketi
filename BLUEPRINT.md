# Chiketi — Architecture Blueprint

> **Note (2026-06):** Chiketi was originally prototyped with pygame (pixel
> rendering). It has since been re-architected as an **HTTP server that renders
> the dashboards as HTML/CSS/JS in a Chromium kiosk**. This document describes
> the current architecture. The pygame design is retired; git history retains it
> if needed.

## What Is This

A system-monitoring dashboard for a dedicated small display. A Python HTTP
server collects metrics and serves two browser surfaces:

- **`/display`** — the full-screen dashboard, shown in a Chromium kiosk on the
  dedicated screen (built for a GeeekPi 7" 1024×600 on HDMI, works on any HDMI
  display).
- **`/`** — a phone/laptop control panel for switching themes, toggling
  screens, and turning the display on/off.

The dashboards are drawn **in the browser** by JavaScript using each theme's
color palette; Python only collects data and serves the static UI assets.

**Reference hardware:**
- Display: GeeekPi 7" 1024×600 on HDMI (acts as a normal HDMI monitor)
- Host: Ubuntu Linux, NVIDIA GPU optional
- Multi-monitor: intended for a dedicated single-display host. DisplayManager
  detects the first connected screen's size via xrandr and launches Chromium
  there; it does not pin Chromium to a specific output, so a multi-monitor
  desktop may land it on the wrong screen unless the display has its own X
  server / session.

## Project Structure

```
chiketi/
├── pyproject.toml
├── chiketi/
│   ├── __init__.py
│   ├── __main__.py              # CLI: chiketi / python -m chiketi
│   ├── app.py                   # MetricEngine thread, DisplayManager, run()
│   ├── server.py                # HTTP server: API routes + serves assets/ui
│   ├── config.py                # timing, thresholds, display constants
│   ├── themes.py                # 12 themes / 3 families + active-theme state
│   ├── panel_spec.py            # shared design tokens (web_spec())
│   ├── collectors/
│   │   ├── base.py              # MetricCollector ABC + MetricValue dataclass
│   │   ├── registry.py          # platform-aware collector list
│   │   ├── system.py            # hostname + uptime
│   │   ├── cpu.py               # usage, per-core, temp, fans
│   │   ├── memory.py            # RAM + swap
│   │   ├── disk.py              # / and /home
│   │   ├── network.py           # throughput (delta-based)
│   │   ├── gpu_nvidia.py        # NVIDIA GPU stats (pynvml)
│   │   ├── llm.py               # local LLM server (llama.cpp / Ollama / vLLM)
│   │   └── claude.py            # Claude Code usage from local JSONL logs
│   └── assets/
│       ├── ui/                  # the browser UI (see "UI Architecture")
│       │   ├── display.html     # kiosk page shell
│       │   ├── display.css      # kiosk styles
│       │   ├── display_app.js   # kiosk poll loop, scaling, rotation
│       │   ├── control.html     # control-panel shell
│       │   ├── control.css      # control-panel styles
│       │   ├── control_app.js   # control-panel logic
│       │   ├── screen_functions.js  # the dashboard renderers (shared)
│       │   ├── shared_helpers.js     # shared render helpers (tBar/lPanel/…)
│       │   └── fonts.css        # @font-face for the bundled fonts
│       └── fonts/               # bundled display fonts
├── docs/                        # GitHub Pages website (separate from the app)
├── scripts/
│   ├── install.sh               # one-line installer
│   ├── gen_site_assets.py       # regenerates the website's data + renderer
│   ├── run.sh                   # launch helper
│   └── chiketi.desktop          # autostart entry
└── tests/                       # pytest suite (83 tests)
```

## Dependencies

```toml
dependencies = ["psutil>=5.9"]                 # CPU/mem/disk/network
[project.optional-dependencies]
nvidia = ["nvidia-ml-py>=12.0"]                # NVIDIA GPU via NVML
dev    = ["pytest>=7.0"]
```

Local-LLM detection and Claude-usage collection use only the standard library
(`urllib`, file reads). Chromium is a runtime requirement (any of `chromium`,
`chromium-browser`, `google-chrome`).

## Data Flow

```
MetricEngine (threading.Thread, ~1.5s interval)        [chiketi/app.py]
  → collect from every registered collector
      SystemCollector  → {"sys.hostname": MetricValue, ...}
      CpuCollector     → {"cpu.usage": MetricValue, ...}
      MemoryCollector  → {"mem.ram_used": MetricValue, ...}
      DiskCollector    → {"disk.root_used": MetricValue, ...}
      NetworkCollector → {"net.dl": MetricValue, ...}
      GpuNvidiaCollector → {"gpu.temp": MetricValue, ...}
      LlmCollector     → {"llama.status": MetricValue, ...}
      ClaudeCollector  → {"claude.tokens_total": MetricValue, ...}
  → store latest dict atomically (safe under the GIL)

HTTP Server (port 7777)                                 [chiketi/server.py]
  GET /display      → display.html (+ inlined css/js from assets/ui)
  GET /             → control.html (+ inlined css/js)
  GET /api/metrics  → JSON of the latest MetricValue dict
  GET /api/themes   → all theme palettes + active family/variant
  GET /api/display  → display on/off, brightness, screen-rotation config
  POST /api/theme/… → switch active theme
  POST /api/display → set display power / rotation / brightness

Browser (Chromium kiosk)                                [assets/ui/*.js]
  display_app.js: every ~2.5s fetch /api/themes + /api/metrics + /api/display
    → pick the active theme's palette
    → call the matching renderer in screen_functions.js with that palette
    → inject the returned HTML into the page; auto-rotate enabled screens
```

The dashboards re-render on each poll, so metrics are always current. Theme
switching is detected by comparing the active family/variant from `/api/themes`.

## UI Architecture (assets/ui)

The browser UI is plain HTML/CSS/JS, extracted from `server.py` into
`chiketi/assets/ui/` so it is editable as real front-end files. At request time
`server.py` reads and inlines these assets (cached at module level) into the
page it serves, substituting a few dynamic values:

- `__PANEL_SPEC_JSON__` → `panel_spec.web_spec()` (design tokens)
- `__PAUSE_S__` → rotation pause duration (display page)
- `__SCREEN_FUNCTIONS__` / `__SHARED_HELPERS__` / `__FONTS_CSS__` → the shared
  JS/CSS blocks

**Theming is client-side.** The CSS carries only layout (sizes in `cqw`
container units); all colors come from inline styles the renderers build from
the active theme palette fetched via `/api/themes`. This is why the same
renderers produce all 12 themes — and why the website (below) can reuse them
with a frozen palette snapshot.

## Collector Design

Every collector subclasses `MetricCollector` and returns
`dict[str, MetricValue]`.

**MetricValue** carries `value`, `unit`, `available` (False if unreadable), and
`extra` (totals/limits/raw context).

**Rules:**
- Collectors never raise — they catch internally and set `available=False`.
- Metric keys use `namespace.name` (e.g. `gpu.vram_used`).
- The registry returns all collectors; missing hardware degrades gracefully.

### Metric Keys Reference

| Collector | Keys (selected) | Notes |
|-----------|------------------|-------|
| SystemCollector | `sys.hostname`, `sys.uptime` | uptime "Xd Xh Xm" |
| CpuCollector | `cpu.usage`, `cpu.per_core`, `cpu.temp`, `cpu.fan(s_*)`, `cpu.mb_temp` | temp/fans via sensors |
| MemoryCollector | `mem.ram_*`, `mem.swap_*` | GiB |
| DiskCollector | `disk.root_*`, `disk.home_*` | auto TiB/GiB |
| NetworkCollector | `net.dl`, `net.ul`, `net.ip`, `net.mac`, `net.speed` | delta-based throughput |
| GpuNvidiaCollector | `gpu.name/temp/fan/power/vram_*/util/clock_*/processes` | pynvml, lazy NVML init |
| LlmCollector | `llama.status/health/model/quant/context/backend` | llama.cpp/Ollama/vLLM autodetect |
| ClaudeCollector | `claude.tokens_*`, `claude.session_*`, `claude.sparkline`, … | parses local Claude Code JSONL |

## Screens

Three rotating screens, rendered per theme family in `screen_functions.js`:

1. **System Stats** — CPU/RAM/disk donuts or bars, thermals, network, host info.
2. **Theme-specific** — Terminal themes render a **GPU / AI Monitor** (GPU
   utilization, VRAM, power, clocks; local-LLM status); Panel and Vintage
   themes render a **Clock**.
3. **Claude Code Usage** — token usage by type, messages, session stats, live
   token-rate sparkline.

The Panel family lays these out as titled color panels with donuts; Terminal as
monospace ASCII-bar panels; Vintage with CRT/VFD/nixie styling.

## Themes

12 themes across 3 families (`chiketi/themes.py`):

- **Panel** — Gold, Teal, Coral (filled header bars, donut gauges)
- **Terminal** — hacker, cyan, amber, phosphor, red_alert, blue (monospace, ASCII bars)
- **Vintage** — Scanlines, Tubes, VFD (CRT glow / nixie / vacuum-fluorescent)

Each theme exposes a palette (`primary`, `accent`, `background`, `panel`,
`border`, `header`, `dim`, `critical`) served via `/api/themes`.

## Display & Control

- **DisplayManager** (`app.py`) launches/kills the Chromium kiosk and switches
  between the graphical session and the console for display on/off.
- **Control panel** (`/`) lets a phone/laptop switch themes, toggle individual
  screens with custom rotation durations, set brightness, and turn the display
  on/off — all via the `/api/*` routes.
- **Display detection** reads the first connected output's resolution from
  xrandr and sizes the Chromium window to it. There is no per-output targeting,
  so the kiosk is best run on a host whose only (or primary) display is the
  dedicated panel — or one where the panel has its own X server / session.

## Key Decisions

1. **Browser rendering, not pixel rendering.** Serving HTML/CSS/JS to a Chromium
   kiosk makes the rich retro themes (CRT glow, nixie tubes, donut gauges) far
   easier to build and iterate than pixel drawing, and yields the control panel
   and website for free.
2. **Client-side theming.** Layout in CSS (`cqw` units), colors injected at
   render time from the theme palette — one set of renderers covers all 12
   themes and scales to any container size.
3. **UI extracted to `assets/ui/`.** The HTML/CSS/JS lives in real files (not
   Python strings), inlined by `server.py` at request time. Editable, testable,
   reusable by the website.
4. **Collectors never raise.** Each catches its own errors and reports
   `available=False`; one failing collector never breaks the dashboard.
5. **Thread-safe metrics.** The MetricEngine daemon thread replaces the latest
   dict atomically; the server reads it without locking.
6. **Graceful degradation.** Missing GPU, sensors, LLM server, or Claude logs
   simply render as unavailable.
7. **Minimal dependencies.** `psutil` is the only hard dependency; NVIDIA
   support is an optional extra; LLM/Claude collection uses the stdlib.

## Testing

A headless `pytest` suite (83 tests) covers the pure helpers, theme management,
`panel_spec`, config, the collectors (with `psutil`/NVML/HTTP mocked), and the
HTTP server routes (via an ephemeral-port server). No display, GPU, or network
is required. CI runs it on Python 3.11–3.13 plus a build, on every push/PR.

## The Website (docs/)

`docs/` is a separate GitHub Pages site (the "chiketi family" marketing site),
not part of the running app. It reuses the product's real renderers
(`assets/ui/screen_functions.js` + `shared_helpers.js`) with a **frozen data
snapshot** generated by `scripts/gen_site_assets.py`, so the hero and gallery
render all 12 dashboards live in the browser with no server. Regenerate after
changing themes, `panel_spec`, or the renderers:

```bash
python scripts/gen_site_assets.py
```

Live at https://rohanprakash12.github.io/chiketi/.
