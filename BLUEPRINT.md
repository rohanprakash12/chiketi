# Chiketi — Architecture Blueprint

> **v0.1.0.** This document describes the architecture as tagged.
>
> Chiketi was originally prototyped with pygame (pixel rendering). It has since
> been re-architected as an **HTTP server that renders the dashboards as
> HTML/CSS/JS in a Chromium kiosk**. The pygame design is retired; git history
> retains it if needed.

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
│   ├── config.py                # timing constants
│   ├── state.py                 # versioned settings persistence (atomic writes)
│   ├── themes.py                # 16 themes / 3 families + active-theme state
│   ├── panel_spec.py            # shared design tokens (web_spec())
│   ├── collectors/
│   │   ├── base.py              # MetricCollector ABC + MetricValue dataclass
│   │   ├── registry.py          # platform-aware collector list
│   │   ├── system.py            # hostname, uptime, kernel, top processes
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
│       │   ├── shared_helpers.js     # esc, Terminal panels, capacity formatting
│       │   └── fonts.css        # @font-face for the bundled fonts
│       └── fonts/               # bundled display fonts
├── docs/                        # GitHub Pages website (separate from the app)
├── scripts/
│   ├── install.sh               # one-line installer
│   ├── gen_site_assets.py       # regenerates the website's data + font mirror
│   ├── check_js.sh              # node --check for the inlined UI JavaScript
│   ├── run.sh                   # launch helper
│   └── chiketi.desktop          # reference autostart entry (installer generates its own)
└── tests/                       # pytest suite (572 tests) + tests/js/ renderer harness
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
renderers produce all 16 themes — and why the website (below) can reuse them
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
| SystemCollector | `sys.hostname`, `sys.uptime`, `sys.kernel`, `sys.top_procs` | uptime "Xd Xh Xm"; top processes cached 3s |
| CpuCollector | `cpu.usage`, `cpu.per_core`, `cpu.temp`, `cpu.fan(s_*)`, `cpu.mb_temp` | temp/fans via sensors |
| MemoryCollector | `mem.ram_*`, `mem.swap_*` | GiB |
| DiskCollector | `disk.root_*`, `disk.home_*` | auto TiB/GiB |
| NetworkCollector | `net.dl`, `net.ul`, `net.ip`, `net.mac`, `net.iface`, `net.speed`, `net.ping` | delta-based throughput |
| GpuNvidiaCollector | `gpu.name/temp/fan/power/vram_*/util/mem_util/clock_*/processes`, `gpu.cards`, `gpu.count` | pynvml, lazy NVML init; `gpu.cards` is the per-card list the GPU screen adapts to |
| LlmCollector | `llama.status/health/model/quant/context/backend/tok_per_sec/active_slots/processes` | llama.cpp/Ollama/vLLM autodetect |
| ClaudeCollector | `claude.tokens_*`, `claude.session_*`, `claude.sparkline`, … | parses local Claude Code JSONL |

## Screens

Five screens, each rendered per theme family in `screen_functions.js`. The
control panel enables, disables and times each one individually.

1. **System Stats** — CPU/RAM/VRAM gauges, thermals with fans, capacity bars,
   network identity and throughput. Sci-Fi and Vintage also carry the
   chronometer in the top-left region.
2. **NPU / AI Monitor** — the local LLM server: throughput, model, quant,
   context, slots, VRAM residency, service health.
3. **Claude Code usage** — tokens by type, messages, session totals, monthly
   averages, a live token-rate plot, agents spawned.
4. **GPU** — adaptive to card count: one card in full, two side by side,
   three or more as compact tiles. Zero cards render an honest empty state.
5. **Clock** — a full-screen chronometer. Sci-Fi and Vintage only; the
   Terminal distro boards draw the time in block characters on screen 1.

**Every family draws all of its own screens.** This is load-bearing, and it was
not true before v0.1: screen 4 fell through to the Sci-Fi TOS board for the six
Terminal palettes, screen 3 was a single generic renderer shared by all sixteen
themes, and the distro boards borrowed the classic Terminal AI screen. The
registry in `display_app.js` / `control_app.js` now names five renderers per
family with no fallback, and the renderer harness asserts against the screen's
*slot* rather than its function name — matching on the name is exactly how the
four distro GPU boards went untested.

### The skin system

Sci-Fi and Vintage share one layout ("Bridge Station") and differ only by skin.
A skin is a table of chrome kind, fonts, palette roles and instrument hooks:

- **chrome** — `spine` (TOS: a glowing rail down the region's left edge),
  `tab` (DS9/TNG: a header tab with a rule running out of it), `rule`
  (Vintage: a hairline under the title).
- **palette roles** — `a1`–`a4`, `cLink`, `cPing`, `cRecv`, `cSend`, `cIp`,
  `cMac`, `cPower`, `therm(t)`, … so a reading is the same colour everywhere.
- **instrument hooks** — `gauge`, `gpuGauge`, `capBar`, `thermRowFn`,
  `fanRowFn`, `clockFn`, `barFn`, `glowFn`, `overlay`, `defs`. Tubes swaps in
  magic eyes and nixie digits; VFD swaps in segmented bars; Scanlines adds a
  CRT overlay stack and a two-stage halo.

One layout change therefore lands in six themes at once, and a family keeps its
own vocabulary without a second copy of the layout.

### Sizing

`.screen-frame` is 1024px wide on the kiosk and roughly 350px in the control
panel's live preview. Everything is authored against the 1024px grid and
emitted in container units — `gq(px)` returns `cqw` — so both scale. **Absolute
`px` for layout does not scale**, and the harness fails any renderer that emits
it, which is how a distro board once shipped 1010×480 of content into a 352×206
preview.

Character grids need a further allowance: Chromium snaps a monospace advance to
whole pixels, so a row that just fits at 1024px runs about 7% wide at 352px.
The conky-style boards size their block graphs with that headroom.

## Themes

16 themes across 3 families (`chiketi/themes.py`):

- **Sci-Fi** — TOS (gold, Chakra Petch, spine chrome), DS9 (teal, Rajdhani,
  chamfered tab), TNG (coral, Antonio, pill tab)
- **Terminal** — six classic palettes (hacker, cyan, amber, phosphor,
  red_alert, blue) drawn as bordered panels with character meters, plus four
  distro boards (Arch, Ubuntu, openSUSE, Mandriva) in the conky idiom each
  distro ships: dense monospace, block-height history, block-character clock
- **Vintage** — Scanlines (a phosphor CRT), Tubes (nixie + magic eye), VFD
  (vacuum-fluorescent segments)

The Sci-Fi family was called `Panel` (Gold/Teal/Coral) before v0.1;
`state.py` migrates saved settings through `_THEME_RENAMES`.

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

A headless `pytest` suite (572 tests) covers the pure helpers, theme
management, `panel_spec`, config, settings persistence, the collectors (with
`psutil`/NVML/HTTP mocked), and the HTTP server routes (via an ephemeral-port
server).

`node tests/js/render_harness.js` renders every (fixture × theme × screen)
combination and fails on:

- an exception, or `undefined` / `NaN` / `[object Object]` in the output;
- an unescaped metric — detected by tokenizing the HTML and flagging any `<`
  that does not open a well-formed tag, or a tag name absent from that
  renderer's clean render. The obvious check (does the output contain `<img`?)
  is defeated by any renderer that transforms a value character by character:
  `nixieDigit` wraps every character in its own span, and two real leaks hid
  behind exactly that for a whole phase;
- a GPU screen that does not explain an empty card list, or truncates a
  multi-card rig without saying so;
- layout sized in absolute `px`, which does not scale to the control-panel
  preview;
- a metric key the renderers read that the `FULL` fixture does not define —
  otherwise that code path is only ever rendered in its unavailable state.

`scripts/check_js.sh` syntax-checks the UI JavaScript that `server.py` inlines.
No display, GPU, or network is required. CI runs all three on Python 3.11–3.13,
plus a build, on every push/PR.

## The Website (docs/)

`docs/` is a separate GitHub Pages site (the "chiketi family" marketing site),
not part of the running app. It reuses the product's real renderers
(`assets/ui/screen_functions.js` + `shared_helpers.js`) with a **frozen data
snapshot** generated by `scripts/gen_site_assets.py`, so the hero and gallery
render all 16 dashboards — and each theme's five screens — live in the browser
with no server. The snapshot's metrics come from `tests/js/fixtures.js`, the
one map a harness assertion keeps complete: a hand-maintained second copy is
how the site ends up quietly rendering a screen's empty state. Regenerate after
changing themes, `panel_spec`, or the renderers:

```bash
python scripts/gen_site_assets.py
```

Live at https://rohanprakash12.github.io/chiketi/.
