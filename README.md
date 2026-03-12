# Chiketi

A real-time system monitoring dashboard designed for dedicated small displays. Renders themed dashboards in a Chromium kiosk, controlled remotely via a phone-friendly web panel.

Built for the GeeekPi 7" (1024x600) but works on any HDMI display.

<!-- Screenshots: uncomment when added
![Panel Gold Theme](screenshots/panel-gold.png)
![Terminal Hacker Theme](screenshots/terminal-hacker.png)
-->

## Features

- **12 themed dashboards** across 3 theme families — Panel, Terminal (hacker/retro), and Vintage (tubes/VFD/scanlines)
- **3 rotating screens** — System stats, GPU/AI monitor, Claude Code usage
- **Remote control panel** — Switch themes, toggle screens, adjust rotation from your phone at `http://<host>:7777`
- **Display on/off toggle** — Turn the dashboard on/off from the control panel, restoring the console when off
- **Live metrics** — CPU, memory, disk, network, GPU (NVIDIA), fan speeds, Claude Code token usage
- **Per-screen rotation** — Enable/disable individual screens with custom durations
- **Fan monitoring** — Real-time animated fans grouped by CPU/Case/GPU with speed-proportional rotation
- **Zero config** — Auto-detects hardware, gracefully degrades when sensors are unavailable

## Install

### One-liner (Debian/Ubuntu)

```bash
curl -fsSL https://raw.githubusercontent.com/rohanprakash12/chiketi/main/scripts/install.sh | bash
```

This automatically installs all prerequisites (Python, pip, pipx, git, build tools, lm-sensors), detects NVIDIA GPUs, and installs chiketi.

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
chiketi --theme Panel/Gold

# Custom rotation interval
chiketi --rotate-interval 15

# Target a specific display
chiketi --screen HDMI
```

The dashboard launches Chromium in kiosk mode on the detected display and starts the control panel server on port 7777.

**Control panel:** Open `http://<host-ip>:7777` on your phone or laptop to:
- Browse and switch between all 12 themes
- Preview screens live
- Toggle individual screens on/off with custom rotation durations
- Turn the dashboard display on/off

## Themes

### Panel

| Theme | Font | Style |
|-------|------|-------|
| Gold | Chakra Petch | Gold panels, anticlockwise donuts |
| Coral | Antonio | Pill headers, clockwise donuts |
| Teal | Rajdhani | Angular headers, butt linecap donuts |

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
2. **GPU/AI Monitor** — GPU utilization, VRAM, power, clocks, CUDA processes
3. **Claude Code** — Token usage by type, messages, monthly averages, session stats, live token rate sparkline

## Architecture

```
Collectors (psutil, pynvml, lm-sensors, Claude JSONL)
    ↓
MetricEngine (background thread, 1.5s interval)
    ↓
HTTP Server (port 7777)
    ├── /display     → Chromium kiosk (fullscreen on GeeekPi)
    ├── /            → Control panel (phone/laptop)
    ├── /api/metrics → JSON metrics endpoint
    └── /api/themes  → Theme management
    ↓
DisplayManager
    ├── turn_on()  → Launch Chromium kiosk, switch to X (vt7)
    └── turn_off() → Kill Chromium, switch to console (vt1)
```

## Requirements

- **Python** 3.11+
- **psutil** — CPU, memory, disk, network metrics
- **Chromium** — Dashboard display (chromium, chromium-browser, or google-chrome)
- **lm-sensors** (optional) — Fan speed detection
- **nvidia-ml-py** (optional) — NVIDIA GPU metrics

### Fan monitoring setup

```bash
sudo apt install lm-sensors
sudo sensors-detect    # follow prompts
sudo modprobe nct6775  # or your chipset's module
```

## Configuration

| CLI flag | Default | Description |
|----------|---------|-------------|
| `--theme` | `Panel/Gold` | Initial theme (`Panel/Gold`, `Terminal/hacker`, `Vintage/VFD`, etc.) |
| `--rotate-interval` | `10` | Seconds between screen auto-rotation |
| `--screen` | auto-detect | Target display by name substring (e.g. `HDMI`) |

All settings can also be changed at runtime via the control panel.

## License

MIT
