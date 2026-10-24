# Changelog

All notable changes to chiketi. Dates are the tag date.

## Unreleased

Chiketi grows from one dashboard on one panel into a server for several displays.

### GPUs screen
- A Kiosk **GPUs** screen: every NVIDIA GPU on the Home Lab hosts, worst first, with
  load, VRAM, temperature, power, process count and a one-word state. Readings that
  are old (host offline, driver unreadable, poller stalled) say so, with their age;
  the last readings are remembered across restarts.
- **Probe v2** (`chiketi-probe`): one time-boxed `nvidia-smi` sample with an explicit
  outcome, and a per-card process count (never names or PIDs). Redeploy it with
  `chiketi-site deploy probe <host>`; hosts on the old probe show temperatures only.
- Home Lab raises one issue per GPU for heat or throttling, cleared only by a
  reading that shows it is over.
- Throttling is judged over the last few polls: a card whose driver reports a
  slowdown on and off (seen on a V100 at its memory-heat limit) reads THROTTLING
  steadily, and the alert needs 3 slowdowns in the last 4 polls. The probe also
  reports each card's memory temperature (shown under the core temperature) and
  its UUID, so a swapped card never inherits another's history.
- New Kiosk displays get Home Lab, Sessions and GPUs; saved displays are unchanged.

### Screen modes
- Each display has a **mode** — **Kiosk** (the house: Home Lab, Sessions, and tabs for
  Overview, My Day, My Home, AI Harness and GPUs to come; Sci-Fi / TOS and Others /
  Claude) or **Self** (the machine's own stats, screens 1–5, every theme) — and its
  **own ordered list of screens**, set in the control panel.
- The tab bar is drawn from the display's own screens, so every lit tab leads to a
  screen (a tab on a touch display could do nothing when its screen was switched off).
- One description of the screens (`assets/ui/screens.json`) replaces four copies of
  the screen registry.
- The house-wide screen list and per-screen durations are gone; `state.json` is
  migrated on first start (the old file is kept as `state.json.bak-YYYYMMDD`).
  A **Kiosk house theme** joins the house theme.
- chiketi's own screen is the display `local`, approved at start without pairing.
- `--rotate-interval` now sets the starting seconds for a new display (default 30).

### Screens and themes
- **Claude Sessions** (screen 7): live Claude Code and Codex sessions — needs input /
  working / idle, total tokens, running subagents, a Claude or Codex mark per row —
  from the new `companions/session-feed`.
- **Home Lab** (screen 6): management-by-exception host health from read-only SSH
  probes (`assets/probe/`), gateway, HTTP and backup checks, with hold/clear rules and
  SMART baselines. Unraid space is judged on the whole array.
- Shared header for the new screens: status colour bar, a tab per screen (lit sci-fi
  icons; the Sessions tab is the Claude mark), date and clock.
- **Others / Claude** theme: a calm slate palette (17 themes, 4 families).
- The Sci-Fi clock is fluid.

### Any screen shape
- The frame follows the screen's aspect; fluid screens fill landscape shapes from 16:9
  to 4:3, and a new **strip** layout class serves bar displays (e.g. 1920×462).
  Screens without a layout for a shape are letterboxed, never cropped.

### Several displays
- **Devices and pairing**: every display registers; new ones show a pairing code
  until approved; per-display theme, auto-rotate and seconds; capabilities (size,
  touch, browser, picture feed) set the starting settings; browsers too old for
  chiketi get a message instead of a broken page.
- **The control panel is the hub**: a display drop-down scopes theme and rotation to
  one display; approve, reject, rename and forget displays.
- Touch: swipe between screens or tap a tab.
- Open displays reload themselves when the server runs newer code.
- `--no-kiosk` runs chiketi as a server only. `/display` may be framed by a kiosk
  wrapper page; the control panel may not.
- `companions/lcd-snap` renders `/display` as pictures for a screen with no browser.

## 0.1.0 — 2026-08-29

First tagged release. Chiketi has been running on a dedicated panel for a
while; this is the point at which the sixteen themes, the five screens and the
website all describe the same product.

### Themes

- **16 themes across 3 families.** Sci-Fi (TOS, DS9, TNG), Terminal (six
  classic palettes plus four distro boards), Vintage (Scanlines, Tubes, VFD).
- The Sci-Fi family was `Panel` (Gold / Teal / Coral). `state.py` migrates a
  saved `Panel/Gold` to `Sci-Fi/TOS` on load, so an existing settings file
  keeps its choice instead of silently falling back to the default.
- **Scanlines is a phosphor CRT**, not a second VFD: anisotropic beam smear
  along the scan direction, a square-root halation law measured against
  reference stills, shadow-mask triads, Gaussian scanline weighting,
  brightness-gated bloom, refresh haze and overscan.
- **Tubes** gained stacked cathodes (unlit digits visible as ghosts behind the
  lit one), an anode mesh, magic-eye gauges whose shadow closes as signal
  rises, and bargraph filaments on every meter — storage rows included, which
  was the one place the family had two vocabularies.
- **Four distro boards** — Arch, Ubuntu, openSUSE, Mandriva — modelled on the
  conky configuration each distro is known by: a dense monospace grid, a title
  with a rule running out of it, character meters, block-height history graphs,
  a tabular process listing, and the time drawn large in block characters.

### Screens

- **Five screens**, each individually enabled, disabled and timed from the
  control panel: System Stats, NPU / AI Monitor, Claude Code usage, GPU, Clock.
- **Every family now draws all of its own screens.** Screen 4 used to fall
  through to the Sci-Fi TOS board for the six Terminal palettes; screen 3 was a
  single generic renderer shared by all sixteen themes; the distro boards
  borrowed the classic Terminal AI screen. All three are fixed.
- The classic Terminal screen 2 was itself a second GPU board. It is the AI
  monitor now, matching what Sci-Fi and Vintage put on screen 2.
- **The GPU screen adapts to card count** — one card in full, two side by side,
  three or more as tiles — and says so when a rig has more cards than the grid
  holds rather than truncating in silence.
- **Density pass for a 10" panel read from a distance.** Gauge captions moved
  inside their rings, the rings grew, thermal and comms rows were rebuilt
  around larger type, and the chronometer became a full quadrant. Verified by
  measured overflow, edge-ink, preview-width and space-coverage checks rather
  than by eye.

### Metrics

- `sys.kernel` and `sys.top_procs` (3-second cache) for the distro boards.
- `gpu.cards` / `gpu.count`: the per-card list the GPU screen adapts to, with
  NVML and sysfs backends.
- `llama.tok_per_sec`, `llama.active_slots`, `llama.health`, `llama.processes`.

### Fixes

- **The website's hero device was blank.** `site.js` still defaulted to the
  retired `Panel/Gold`; `renderThemeInto` correctly refuses an unknown theme,
  so it rendered nothing. Defaults are now validated like `?t=` already was.
- SVG ids are slugified — `url(#og-GPU VRAM)` matches nothing, which unlit a
  whole magic eye and cost VFD its bloom.
- Glow no longer scales linearly with font size. The measured law is
  `1.27 × √px`; the old `px / 2.6` fogged the Scanlines chronometer.
- Unit spans no longer inherit a bright halo while being recoloured dim.
- Thermal bar and capacity bar widths are derived from their rows and from the
  skin's chrome inset, not guessed — a fixed 442px pushed THERMALS 16px over
  and misaligned DS9's storage rows.

### Tooling

- The renderer harness renders every (fixture × theme × screen) combination and
  fails on: exceptions, `undefined`/`NaN` in the output, unescaped metrics
  (detected by tokenizing, not by matching a payload), a GPU screen that does
  not explain an empty or truncated card list, layout sized in absolute `px`,
  and any metric key the renderers read that no fixture supplies.
- The px allowlist is empty. Every renderer is sized in container units.
- The website's demo metrics come from `tests/js/fixtures.js` rather than a
  hand-maintained second copy, so the site cannot quietly start rendering a
  screen's empty state.
- The gallery on the website exposes all five screens per theme.

### Known leftovers

- `lPanel` / `lStat` / `lBar` in `shared_helpers.js`, and the `.l-*` block in
  `display.css` / `control.css`, are unreferenced remnants of the pre-skin
  Panel family. They are inert; removing them is a follow-up.
