# Chiketi

A real-time system monitoring dashboard designed for dedicated small displays. Renders themed dashboards in a Chromium kiosk, controlled remotely via a phone-friendly web panel.

Built for the GeeekPi 7" (1024x600) but works on any HDMI display.

**Website:** https://rohanprakash12.github.io/chiketi/ — live, interactive theme gallery (try all 12 themes in your browser).
**Companion product:** [chiketi-appliance](https://github.com/rohanprakash12/chiketi-appliance) — monitor *remote* servers over SSH from a dedicated Raspberry Pi.

## Features

- **12 themed dashboards** across 3 theme families — Sci-Fi (TOS/DS9/TNG), Terminal (hacker/retro), and Vintage (tubes/VFD/scanlines)
- **3 rotating screens** — System stats, a theme-specific second screen (GPU/AI monitor on Terminal themes, a clock on Sci-Fi/Vintage), and Claude Code usage
- **Remote control panel** — Switch themes, toggle screens, adjust rotation from your phone at `http://<host>:7777`
- **Display on/off toggle** — Turn the dashboard on/off from the control panel, restoring the console when off
- **Live metrics** — CPU, memory, disk, network, GPU (NVIDIA), fan speeds, local LLM server (llama.cpp / Ollama / vLLM), Claude Code token usage
- **Per-screen rotation** — Enable/disable individual screens with custom durations
- **Fan monitoring** — Real-time animated fans grouped by CPU/Case/GPU with speed-proportional rotation
- **Zero config** — Auto-detects hardware; readings it cannot take render as `N/A` rather than erroring or vanishing

## Install

### One-liner (Debian/Ubuntu)

```bash
curl -fsSL https://raw.githubusercontent.com/rohanprakash12/chiketi/main/scripts/install.sh | bash
```

This automatically installs all prerequisites (Python, pip, pipx, git, build tools, lm-sensors), detects NVIDIA GPUs, and installs chiketi.

#### Autostart on login

Near the end, the installer asks:

```
Enable autostart on login? [y/N]
```

Answering `y` writes `~/.config/autostart/chiketi.desktop`, so the dashboard
starts with your desktop session. Anything else skips it — autostart is opt-in.

The prompt reads from your terminal, not from stdin, so it still works through
`curl ... | bash`. When there is no terminal at all (CI, cron, a non-interactive
pipe) the installer skips autostart and says so. Pass a flag to decide up front
and skip the question:

```bash
curl -fsSL .../install.sh | bash -s -- --autostart      # enable, no prompt
curl -fsSL .../install.sh | bash -s -- --no-autostart   # skip, no prompt
```

To remove autostart later, delete `~/.config/autostart/chiketi.desktop`.

### Manual install

**Prerequisites:**

```bash
# Debian/Ubuntu
sudo apt install python3 python3-pip python3-venv python3-dev gcc git lm-sensors

# Install pipx
python3 -m pip install --user pipx
pipx ensurepath
```

**Install chiketi:**

```bash
pipx install git+https://github.com/rohanprakash12/chiketi.git

# With NVIDIA GPU support
pipx install "chiketi[nvidia] @ git+https://github.com/rohanprakash12/chiketi.git"
```

**Or from source:**

```bash
git clone https://github.com/rohanprakash12/chiketi.git
cd chiketi
pip install .          # basic
pip install .[nvidia]  # with NVIDIA GPU support
```

## Usage

```bash
# Start the dashboard
chiketi

# Specify a theme
chiketi --theme Sci-Fi/TOS

# Custom rotation interval
chiketi --rotate-interval 15

# Restrict the control server to localhost (default binds the LAN)
chiketi --bind 127.0.0.1

# Require a shared secret on control actions
chiketi --token s3cret   # then open http://<host>:7777/?token=s3cret
```

The dashboard launches Chromium in kiosk mode on the detected display and starts the control panel server on port 7777.

**Control panel:** Open `http://<host-ip>:7777` on your phone or laptop to:
- Browse and switch between all 12 themes
- Preview screens live
- Toggle individual screens on/off with custom rotation durations
- Turn the dashboard display on/off

## Themes

### Sci-Fi

| Theme | Font | Style |
|-------|------|-------|
| TOS | Chakra Petch | Gold spine regions, anticlockwise donuts |
| TNG | Antonio | Pill headers, clockwise donuts |
| DS9 | Rajdhani | Chevron headers, butt linecap donuts |

### Terminal

Six color variants: **hacker** (green), **cyan**, **amber**, **phosphor**, **red_alert**, **blue**

### Vintage

| Theme | Style |
|-------|-------|
| Scanlines | CRT scanline overlay, retro green |
| Tubes | Warm amber nixie tube aesthetic |
| VFD | Vacuum fluorescent display glow |

## Screens

1. **System Stats** — CPU usage/temp, memory, disk, network throughput, fan speeds
2. **Theme-specific** — Terminal themes show a **GPU/AI Monitor** (GPU utilization, VRAM, power, clocks, CUDA processes); Sci-Fi and Vintage themes show a **Clock**
3. **Claude Code** — Token usage by type, messages, monthly averages, session stats, live token rate sparkline

## Architecture

```
Collectors (psutil, pynvml, lm-sensors, llama.cpp/Ollama, Claude JSONL)
    ↓
MetricEngine (background thread, ~1.5s interval)
    ↓
HTTP Server (port 7777)  — chiketi/server.py
    ├── /display     → Chromium kiosk (fullscreen on the display)
    ├── /            → Control panel (phone/laptop)
    ├── /api/metrics → JSON metrics endpoint (polled by the browser)
    ├── /api/themes  → Theme palettes + active theme
    └── /api/display → Display on/off, rotation, brightness
    ↓
Browser (Chromium kiosk) renders HTML/CSS/JS from chiketi/assets/ui/
    └── screen_functions.js draws the dashboards using the theme palette
    ↓
DisplayManager
    ├── turn_on()  → Launch Chromium kiosk, switch to X
    └── turn_off() → Kill Chromium, switch to console
```

The dashboard UI is **not** Python-rendered — the server serves HTML/CSS/JS
(under `chiketi/assets/ui/`) that the browser executes, fetching live metrics
from `/api/metrics` and theme colors from `/api/themes`. See
[BLUEPRINT.md](BLUEPRINT.md) for the full design.

## Requirements

- **Python** 3.11+
- **psutil** — CPU, memory, disk, network metrics
- **Chromium** — Dashboard display (chromium, chromium-browser, or google-chrome)
- **lm-sensors** (optional) — Fan speed detection
- **nvidia-ml-py** (optional, `[nvidia]` extra) — NVIDIA GPU metrics

### Fan monitoring setup

```bash
sudo apt install lm-sensors
sudo sensors-detect    # follow prompts
sudo modprobe nct6775  # or your chipset's module
```

## Configuration

| CLI flag | Default | Description |
|----------|---------|-------------|
| `--theme` | `Sci-Fi/TOS` | Initial theme (`Sci-Fi/TOS`, `Terminal/hacker`, `Vintage/VFD`, etc.) |
| `--rotate-interval` | `10` | Default seconds between screen auto-rotation (per-screen durations override) |
| `--bind` | `0.0.0.0` | Host to bind the control server to (use `127.0.0.1` for localhost only) |
| `--token` | _none_ | Shared secret required on control actions; clients pass it via `?token=…` (or the `CHIKETI_TOKEN` env var) |

All settings can also be changed at runtime via the control panel.

> **Security:** the control server is built for a trusted LAN. By default it
> binds `0.0.0.0` and serves telemetry `GET`s to anyone who can reach the port —
> that is deliberate, so the phone panel just works.
>
> Control actions are narrower. A `POST` is accepted only from a same-origin
> request (or one with no `Origin` at all, i.e. curl and scripts), so a page you
> merely *visit* cannot drive your dashboard. CORS echoes the `Origin` only when
> it matches the host, request bodies are capped at 64 KiB, and responses carry
> `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and, on the
> HTML pages, `X-Frame-Options: DENY`.
>
> Requests are also rejected unless the `Host` header names this machine the
> way you would reach it: an IP literal (your LAN address, or a Tailscale
> `100.64/10` one), `localhost`, a single-label hostname, or a private DNS zone
> (`.local`, `.ts.net`, `.lan`, `.internal`, `.home.arpa`). This closes DNS
> rebinding, where a page you visit points its own domain at your LAN address —
> the `Origin` check alone cannot see that, because the attacker controls the
> name and so `Origin` and `Host` agree. It needs no configuration: a public
> domain is the one thing you never type to reach your own panel.
>
> If the LAN is not trusted: `--bind 127.0.0.1` keeps it local, and `--token`
> (or `CHIKETI_TOKEN`) requires a shared secret on every control action. Neither
> is on by default.

## Development

```bash
git clone https://github.com/rohanprakash12/chiketi.git
cd chiketi
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"     # adds pytest
```

### Tests

Headless test suite (no display/GPU/network needed — collectors and the HTTP
server are exercised with mocks and an ephemeral-port server):

```bash
pytest -q                        # 400+ tests
node tests/js/render_harness.js  # every renderer against hostile payloads
./scripts/check_js.sh            # syntax-check the inlined UI JavaScript
```

CI runs all three on Python 3.11–3.13, plus an sdist/wheel build, on every push
and PR (`.github/workflows/ci.yml`).

### Project layout

```
chiketi/
├── chiketi/
│   ├── __main__.py            # CLI entry point
│   ├── app.py                 # MetricEngine thread + DisplayManager + run()
│   ├── server.py              # HTTP server + API routes (serves assets/ui)
│   ├── themes.py              # 12 themes across 3 families
│   ├── panel_spec.py          # shared design tokens (web_spec)
│   ├── config.py              # timing constants
│   ├── state.py               # versioned settings persistence (atomic writes)
│   ├── collectors/            # system, cpu, memory, disk, network, gpu_nvidia,
│   │                          #   llm (llama.cpp/Ollama/vLLM), claude
│   └── assets/
│       ├── ui/                # dashboard + control-panel HTML/CSS/JS
│       │                      #   (extracted from server.py; server inlines these)
│       └── fonts/             # bundled display fonts + their OFL licences
├── docs/                      # GitHub Pages site (the family website)
│   ├── index.html             # live, theme-switchable marketing site
│   └── site/                  # site CSS/JS + generated data.js/dashboard.js
├── scripts/
│   ├── install.sh             # one-line installer (optional autostart)
│   ├── gen_site_assets.py     # regenerates the site data + mirrors the fonts
│   ├── check_js.sh            # node --check for the inlined UI JavaScript
│   └── run.sh                 # launch helper for a source checkout
└── tests/                     # pytest suite + tests/js/ renderer harness
```

### The website

`docs/` is published via GitHub Pages. The site reuses the product's real
renderers (`chiketi/assets/ui/`) to render all 12 themes live in the browser
from a frozen data snapshot. Regenerate that snapshot after changing themes or
the dashboard renderers:

```bash
python scripts/gen_site_assets.py
```

## Licensing

chiketi itself is **MIT** — see [LICENSE](LICENSE).

The bundled font files are **not** covered by that licence. All six families
(Antonio, Chakra Petch, IBM Plex Mono, Nixie One, Rajdhani, Share Tech Mono)
are licensed under the SIL Open Font License 1.1, and each ships its upstream
licence text next to its `.ttf`. Provenance, copyright lines and the reserved
font names are documented in
[`chiketi/assets/fonts/README.md`](chiketi/assets/fonts/README.md).
