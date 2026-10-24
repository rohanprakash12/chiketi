# Chiketi

A real-time system monitoring dashboard designed for dedicated small displays. Renders themed dashboards in a Chromium kiosk, controlled remotely via a phone-friendly web panel.

Built for the GeeekPi 7" (1024x600) but works on any HDMI display. It also runs
as a **server for several displays** — touch tablets, wall kiosks, a wide USB LCD —
each registered and paired from the control panel (see
[Running as a hub for several displays](#running-as-a-hub-for-several-displays)).

**Version:** 0.1.0 — the first tagged release. See [CHANGELOG.md](CHANGELOG.md).
**Website:** https://rohanprakash12.github.io/chiketi/ — live, interactive gallery: all 16 themes, all five screens, rendered in your browser by the product's own renderers.
**Companion product:** [chiketi-appliance](https://github.com/rohanprakash12/chiketi-appliance) — monitor *remote* servers over SSH from a dedicated Raspberry Pi.

## Features

- **17 themed dashboards** across 4 theme families — Sci-Fi (TOS/DS9/TNG), Terminal (six classic palettes plus four distro boards), Vintage (Scanlines/Tubes/VFD) and Others (Claude)
- **7 screens** — System stats, an AI/NPU panel, Claude Code usage, a GPU board, a clock, Home Lab and Claude Sessions. Every screen is drawn in its own family's chrome; none of them borrows another family's renderer
- **Sized for a small panel read from a distance** — the layouts were tuned against measured overflow, edge-ink and space-coverage checks on a 10" screen, not by eye
- **Remote control panel** — Switch themes, toggle screens, adjust rotation from your phone at `http://<host>:7777`
- **Display on/off toggle** — Turn the dashboard on/off from the control panel, restoring the console when off
- **Live metrics** — CPU, memory, disk, network, GPU (NVIDIA), fan speeds, local LLM server (llama.cpp / Ollama / vLLM), Claude Code token usage
- **Per-screen rotation** — Enable/disable individual screens with custom durations
- **Fan monitoring** — Real-time animated fans grouped by CPU/Case/GPU with speed-proportional rotation
- **Zero config** — Auto-detects hardware; readings it cannot take render as `N/A` rather than erroring or vanishing
- **Claude Code and Codex sessions** — a live list of coding-agent sessions (needs input / working / idle, tokens, running subagents), fed by a small companion service on the machine where the sessions run
- **Home Lab** — management-by-exception health of your servers: *ALL SYSTEMS NOMINAL* when healthy, *YELLOW / RED ALERT* with what, where and since when when not; read-only SSH probes enforced on each host
- **Any screen shape** — layouts fill landscape screens from 16:9 to 4:3 and have a dedicated *strip* layout for bar displays (e.g. 1920×462); screens without one are centred, never cropped
- **Several displays, one server** — every display registers; new ones show a pairing code until you approve them in the control panel, and each has its own theme and rotation settings
- **Touch** — swipe between screens or tap a screen's tab

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

# Seconds per screen a new display starts with
chiketi --rotate-interval 15

# Restrict the control server to localhost (default binds the LAN)
chiketi --bind 127.0.0.1

# Require a shared secret on control actions
chiketi --token s3cret   # then open http://<host>:7777/?token=s3cret

# Server only: serve /display and the control panel, never open a local kiosk
chiketi --no-kiosk
```

The dashboard launches Chromium in kiosk mode on the detected display and starts the control panel server on port 7777.

**Control panel:** Open `http://<host-ip>:7777` on your phone or laptop to:
- Pick a display (or the house defaults) and approve new displays
- Browse and switch between all 17 themes
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

Six classic palettes — **hacker** (green), **cyan**, **amber**, **phosphor**, **red_alert**, **blue** — drawn as bordered `──[ PANEL ]` blocks with character meters.

Four distro boards — **Arch**, **Ubuntu**, **openSUSE**, **Mandriva** — modelled on the conky configs each distro is known by: a dense monospace grid, block-height history graphs, character meters, and the time drawn large in block characters. Each carries its own palette.

### Others

| Theme | Style |
|-------|-------|
| Claude | Calm slate board with mint, amber, coral and sky readings, plain sans type, no glow — built for a living room |

### Vintage

| Theme | Style |
|-------|-------|
| Scanlines | A phosphor CRT: anisotropic beam smear, shadow-mask triads, Gaussian scanline weighting, refresh haze and overscan |
| Tubes | Nixie digits with stacked cathodes, magic-eye gauges, bargraph filaments, dekatron fans |
| VFD | Segmented bars over a ghost track, filament lines across the glass |

## Screens

Each display has a **mode**, chosen in the control panel:

- **Self**: the stats of the machine chiketi runs on (screens 1–5), in every theme.
  chiketi's own screen is a Self display.
- **Kiosk**: the house — Home Lab, Claude Sessions and GPUs so far, with Overview,
  My Day, My Home and AI Harness to come. Kiosk screens share a header with a tab per
  screen and are drawn in Sci-Fi / TOS and Others / Claude.

Each display also has its **own ordered list of screens** from its mode: a wide bar
display might show two, a hub monitor all of them. Screens rotate, or are tapped and
swiped through on a touch display. A new display starts in Kiosk when the house has a
`sessions.toml` or `homelab.toml`, otherwise in Self.

| # | Screen | What it shows |
|---|--------|----------------|
| 1 | **System Stats** | CPU / RAM / VRAM gauges, thermals with fans, capacity bars, network identity and throughput. Sci-Fi and Vintage also carry the chronometer here. |
| 2 | **NPU / AI Monitor** | The local LLM server: throughput in tok/s, model, quant, context, slots, VRAM residency, service health. |
| 3 | **Claude Code usage** | Tokens by type (input / output / cache write / cache read), messages, session totals, monthly averages, live token-rate plot, agents spawned. |
| 4 | **GPU** | Adaptive to card count — one card in full, or a grid of tiles for a multi-card rig. Utilisation, VRAM, power, clocks, temperature, per-process VRAM. |
| 5 | **Clock** | A full-screen chronometer in the family's own idiom: nixie digits on Tubes, phosphor glow on Scanlines, LCARS numerals on Sci-Fi. Sci-Fi and Vintage only — the Terminal distro boards draw the time on screen 1. |
| Kiosk | **Home Lab** | Health of the hosts in `homelab.toml`: one light per host, and issue cards (disk space, SMART, temperatures, failed units, Unraid array, gateway, Home Assistant) worst first. Shows once `homelab.toml` exists. |
| Kiosk | **Claude Sessions** | Live Claude Code and Codex sessions from the session feed (`sessions.toml`). Shows once `sessions.toml` exists. |
| Kiosk | **GPUs** | Every NVIDIA GPU on the Home Lab hosts, worst first: load, VRAM, temperature (and the memory temperature, where the card reports it), power and a state (busy, idle, hot, throttling, unreadable, offline). Throttling is judged over the last few polls, so a card that slows itself down on and off reads THROTTLING steadily; Home Lab alerts only when it happens on 3 of 4 polls. A host that stops answering keeps its last readings, dimmed, with their age. Needs `homelab.toml` and the version-2 probe on each GPU host (`chiketi-site deploy probe <host>`); an older probe shows temperatures only. |

The Kiosk header has a colour bar for overall status, a tab for each screen the
display has chosen (tap to switch; a planned screen's tab is grey; a tab fades amber
or red when its area needs attention), and the date and clock.

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
| `--rotate-interval` | `30` | Seconds per screen a new display starts with (each display then has its own, set in the control panel) |
| `--bind` | `0.0.0.0` | Host to bind the control server to (use `127.0.0.1` for localhost only) |
| `--token` | _none_ | Shared secret required on control actions; clients pass it via `?token=…` (or the `CHIKETI_TOKEN` env var) |
| `--no-kiosk` | off | Serve the dashboard and API only; never launch a local Chromium kiosk |

Optional config files in `~/.config/chiketi/` switch on the newer screens:

| File | Enables | Contents |
|------|---------|----------|
| `sessions.toml` | Claude Sessions | `url` of the session feed, `poll_seconds` |
| `homelab.toml` | Home Lab | hosts (`unraid`, `linux`, `gateway`, `http`), SSH key, thresholds — see `chiketi/collectors/homelab/config.py` for every key and default |

Approved displays and their settings are saved in `~/.config/chiketi/state.json`
under `devices`.

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

## Running as a hub for several displays

One chiketi can feed every screen in the house. It runs as `chiketi --no-kiosk` on an
always-on machine, and the displays are browsers (or picture-fed screens) pointed at it.

- **Displays.** Any browser that opens `http://<server>:7777/display` registers.
  A kiosk pins its name in the address, `/display?device=<id>` (1–32 of `a-z 0-9 -`);
  other browsers get a random id kept in local storage. A new display shows a
  pairing code; approve it in the control panel and it switches to dashboards.
  chiketi detects each display's size, touch and browser: touch screens start with
  auto-rotate off (swipe or tap instead), others rotate. Browsers older than
  Chrome 105 / Safari 16 / Firefox 110 get a "too old" message instead of a broken page.
- **The control panel is the hub.** The display drop-down at the top switches the
  panel between *House defaults* and one display. Per display: mode (Kiosk or
  Self), its screens and their order, theme, auto-rotate and seconds per screen.
  The house defaults hold a theme for Kiosk displays and one for Self displays.
  Rename or forget a display there; a forgotten one returns to its pairing code.
- Open displays reload by themselves when the server runs newer code, so a deploy
  needs no visit.

### Deploying with a site folder

Everything about *your* deployment (addresses, logins, which displays exist) lives in a
**site**: a folder of config files kept somewhere private, never in this repository.
`examples/site/` is a complete example with made-up values; copy it and edit it.

```
site/
├── site.toml          # where the server, displays, session feed and probe hosts are
├── server/            # copied as-is to the server's ~/.config/chiketi/
│   ├── sessions.toml
│   └── homelab.toml
└── NOTES.md           # optional
```

`chiketi-site` (installed with chiketi) generates every file chiketi puts on a machine
from the site and chiketi's own templates, so nothing on a machine is hand-edited:

```bash
chiketi-site check --site DIR                      # validate; touches nothing
chiketi-site render kiosk-page --display ID --site DIR   # print a generated file
chiketi-site deploy server  --site DIR [--ref REF]  # git archive → venv, unit, configs, restart, health
chiketi-site deploy display ID --site DIR           # kiosk page/launcher/unit, or lcd-snap + pusher config
chiketi-site deploy feed    --site DIR              # session feed unit and allowlist
chiketi-site deploy probe [HOST…] --site DIR        # Home Lab probe on Linux hosts
```

Every `deploy` takes `--dry-run` (shows a diff against each machine's current copy and
writes nothing). A replaced file is kept as `<file>.bak-YYYYMMDD`; nothing is deleted.
Machines are reached with your own `ssh` (key login, passwordless `sudo`).
`CHIKETI_SITE=DIR` saves typing `--site`. Secrets never go in a site: `check` refuses
keys that look like them and says where they belong on the machine.

What stays manual:
- the kiosk machine's OS, browser and `cage` compositor;
- for a picture display, lcd-snap's Chrome headless shell and venv in `/opt/lcd-snap/`
  (see `companions/lcd-snap/README.md`), and the small program that pushes the pictures
  to the screen's hardware (it reads the generated `pusher.toml`: `url`, `width`,
  `height`, `stale_seconds`);
- approving each new display in the control panel;
- the probe on hosts that are not ordinary Linux (e.g. Unraid).

The parts, for reference:
- **Kiosk wrapper.** A kiosk opens a small local page that frames `/display` and shows
  "server unreachable" if the server stops answering (`/display` is the only page that
  may be framed).
- **Screens without a browser.** `companions/lcd-snap` keeps a headless Chromium on
  `/display?device=<id>&feed=picture` at the screen's size and serves the picture on
  port 7778; the screen's pusher fetches it.
- **Claude Sessions.** `companions/session-feed` runs where your Claude Code / Codex
  sessions run; `sessions.toml` points the server at it.
- **Home Lab.** `homelab.toml` on the server, its own SSH key there, and the read-only
  probe on each host; the host's `authorized_keys` forces that key to run only the probe.

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
pytest -q                        # ~690 tests
node tests/js/render_harness.js  # every renderer, every fixture, every theme
./scripts/check_js.sh            # syntax-check the inlined UI JavaScript
```

Two real-browser checks need a running server and a Chromium
(`CHROME=/path/to/chrome`, `NODE_PATH` pointing at a `playwright-core` install):

```bash
python -m chiketi --no-kiosk --bind 127.0.0.1 &
node scripts/fit_check.mjs       # fluid/strip screens fit every shape (SHAPES=, CASES=)
node scripts/devices_check.mjs   # pairing, per-device settings, control-panel hub
```

The renderer harness is more than a smoke test. It renders every
(fixture × theme × screen) combination and fails on: an exception, an
`undefined`/`NaN` reaching the HTML, an unescaped metric (detected by
tokenizing, not by matching a payload — `nixieDigit` wraps every character in
its own span, so a naive substring check misses real leaks), a GPU screen that
does not explain an empty or truncated card list, layout sized in absolute `px`
(which does not scale between the 1024px kiosk and the ~350px control-panel
preview), and any metric key the renderers read that no fixture supplies.

CI runs all three on Python 3.11–3.13, plus an sdist/wheel build, on every push
and PR (`.github/workflows/ci.yml`).

### Project layout

```
chiketi/
├── chiketi/
│   ├── __main__.py            # CLI entry point
│   ├── app.py                 # MetricEngine thread + DisplayManager + run()
│   ├── server.py              # HTTP server + API routes (serves assets/ui)
│   ├── themes.py              # 17 themes across 4 families
│   ├── panel_spec.py          # shared design tokens (web_spec)
│   ├── config.py              # timing constants
│   ├── state.py               # versioned settings persistence (atomic writes)
│   ├── devices.py             # registered displays: pairing codes, capabilities, settings
│   ├── sites/                 # chiketi-site: site model, templates, deploy over ssh
│   ├── collectors/            # system, cpu, memory, disk, network, gpu_nvidia,
│   │                          #   llm (llama.cpp/Ollama/vLLM), claude, sessions,
│   │                          #   homelab/ (probe parser, rules, checks, poller)
│   └── assets/
│       ├── ui/                # dashboard + control-panel HTML/CSS/JS
│       │                      #   (extracted from server.py; server inlines these;
│       │                      #   pairing.js is ES5 so old browsers get a message)
│       ├── probe/             # chiketi-probe + smart-read: read-only Home Lab probe
│       └── fonts/             # bundled display fonts + their OFL licences
├── docs/                      # GitHub Pages site (the family website)
│   ├── index.html             # live, theme-switchable marketing site
│   └── site/                  # site CSS/JS + generated data.js/dashboard.js
├── companions/                # small services that run next to chiketi
│   ├── session-feed/          # Claude Code / Codex session feed + hook
│   └── lcd-snap/              # renders /display as pictures for a browserless LCD
├── examples/site/             # example site (made-up values) for chiketi-site
├── specs/, plans/             # design specs and implementation plans
├── scripts/
│   ├── install.sh             # one-line installer (optional autostart)
│   ├── install-probe.sh       # install the Home Lab probe on a Linux host
│   ├── fit_check.mjs          # real-browser fit check at every screen shape
│   ├── devices_check.mjs      # real-browser pairing / control-panel check
│   ├── gen_site_assets.py     # regenerates the site data + mirrors the fonts
│   ├── check_js.sh            # node --check for the inlined UI JavaScript
│   └── run.sh                 # launch helper for a source checkout
└── tests/                     # pytest suite + tests/js/ renderer harness
```

### The website

`docs/` is published via GitHub Pages. The site reuses the product's real
renderers (`chiketi/assets/ui/`) to render all 16 themes — and all five
screens — live in the browser from a frozen data snapshot. The snapshot's
metrics are taken from `tests/js/fixtures.js`, the same map a harness assertion
keeps complete, so the site cannot quietly start rendering a screen's empty
state. Regenerate after changing themes or the dashboard renderers:

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
