# chiketi — notes for working on this repo

Themed dashboard for small displays, and a server that feeds several displays.
User-facing docs: `README.md`. Design history: `specs/` (approved designs) and `plans/`
(implementation plans). `CHANGELOG.md` for releases.

**This repo is public on GitHub.** Never commit a real house's addresses, hostnames
tied to addresses, configs or deploy scripts. Use documentation addresses (`192.0.2.x`)
in tests, specs and examples. A real deployment's settings live in a private sibling
repo (here: `../chiketi-private`, which has its own `CLAUDE.md`).

## Setup and checks

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest -q          # ~780 tests
node tests/js/render_harness.js        # every renderer × fixture × theme × shape
./scripts/check_js.sh                  # syntax of the inlined UI JS
.venv/bin/ruff check <changed files>   # old files have pre-existing findings; add none
```

Real-browser checks (need a running server and Chromium; `CHROME=<headless shell>`,
`NODE_PATH=<dir with playwright-core>`):

```bash
XDG_CONFIG_HOME=/tmp/chk-xdg .venv/bin/python -m chiketi --no-kiosk --bind 127.0.0.1 &
node scripts/fit_check.mjs       # SHAPES=1800x1200,1920x462 CASES=screen7:FULL,... narrow it
node scripts/devices_check.mjs   # pairing, settings, modes, tabs, the panel (18 steps; give the
                                 # dev server a sessions.toml so new displays start in Kiosk)
```

Traps:
- The server **caches UI assets at startup**: restart it after editing `assets/ui/*`.
- Stop the dev server by killing the python process only (by its PID); `pkill -f`
  or `pgrep -f "chiketi ..."` also matches your own shell's command line.
- Use a throwaway `XDG_CONFIG_HOME` for dev servers so they don't write your real
  `~/.config/chiketi/state.json`.
- Don't run `ruff format`; follow the existing style.

## How the UI is put together

- `server.py` inlines `assets/ui/*` into two pages: `/display` (the kiosk) and `/`
  (control panel). `screen_functions.js` and `shared_helpers.js` are shared by both
  and by the harness (`tests/js/render_harness.js` evals them).
- **Screens are described once**: `assets/ui/screens.json` (the modes, their themes
  and screens, each screen's tab label and colour and the data it needs) is read by
  `chiketi/screens.py` for validation and inlined into both pages as `SCREEN_SPEC`.
  `screenRenderer(id, family, variant)` and `screenPlan()` at the end of
  `screen_functions.js` say how a theme draws a screen and what a display shows; the
  display, the control panel previews, the harness and the site all use them, and the
  tab bar is drawn from the plan (`setTabPlan`).
- **Harness rules** (it fails the run): no layout `px` over 2 (use `gq(n)` = n/1024
  of the frame width in `cqw`); every metric string through `esc()` (HOSTILE fixtures);
  the `FULL` fixture must define every `m('ns.key')` a renderer reads; no
  `undefined`/`NaN` in output. `let`/`const` in the eval'd files are invisible to
  the harness — expose getters (e.g. `frameH()`).
- **Frame model**: the frame is 1024 units wide and `FRAME_H` tall, from the screen's
  aspect. `layoutClass()` is `landscape` (576–770 units), `strip` (≤ 341, e.g.
  1920×462 → 246) or `other`. Fluid screens use `bsFrame(body, true)` and fill the
  frame; a screen with a strip layout passes `'strip'`; fixed and non-strip screens
  are letterboxed, never cropped.
- **Bridge Station** (Sci-Fi and Others families): skins `BS_SKIN_TOS/TNG/DS9/CLAUDE`
  supply colours by role (`crit`, `warn`, `cLink`, `a1..a4`, `dim`, `label`…).
  Shared chrome for the newer screens: `bsHeader(active)` (status bar, tabs, date,
  clock), `bsStripFrame({...})` for the strip layout, `bsTabs`/`bsTabList`/
  `bsTabAttention` (a tab per screen; built screens in colour, planned ones grey;
  a tab fades amber/red when its area needs you), `bsTabIcon`, `toolMark`.
- **Adding a screen with the shared header** (Sessions / Home Lab style): a `bs<Name>Screen(c)` with full and strip
  layouts, skin wrappers, an entry in `screens.json` (set `built`), its renderers in
  `KIOSK_RENDERERS`, its tab art in `bsTabIcon`, harness fixtures (normal, empty,
  offline, hostile), its attention colour in `bsTabAttention`, then `fit_check` at
  1800×1200 and 1920×462 (`CASES=<id>:<fixture>`, `TABS=n`).

## Collectors

`MetricEngine` runs collectors serially; anything slow or remote runs its own thread
and `collect()` only reads a cache (see `collectors/sessions.py`,
`collectors/homelab/poller.py`). A collector with no config file reports
`<ns>.status = unconfigured` and its screen stays out of the registry.

Home Lab (`collectors/homelab/`): probe output parser, rules with hold/clear counts
and SMART baselines, checks (SSH forced-command probe, gateway TCP/DNS, HTTP,
backup JSON), poller. The probe (`assets/probe/chiketi-probe`, POSIX sh) is
read-only and never wakes sleeping disks (`smartctl -n standby`). Unraid space is
judged on the whole array (`unraid_array_pct`), not each `/mnt/diskN`.

## Devices and pairing

`devices.py` (`DeviceRegistry`): approved devices persist in `state.json` `devices`;
pending pairing requests are memory-only (a restart means new codes). Routes:
`POST /api/register`, `GET`/`POST /api/device/<id>` (a display's own; no token, but
Host/Origin checks) and `/api/devices…` (control panel; token only if one is
configured). Self-service writes are coalesced (one flush at a time, ≤ 1 per 5 s).
`assets/ui/pairing.js` runs first, in **ES5**, works out id and capabilities,
shows the pairing page, and calls `chiketiStart(settings)` in `display_app.js` once
approved. Open displays reload when `/api/display` reports a new `build`.
Each device has a `mode` (`kiosk`/`self`) and an ordered `screens` list, set from the
control panel only (`admin_update`); chiketi's own screen is the device `local`
(`ensure_local`). A pre-modes `state.json` is migrated at start; `_persist()` will not
replace it until `state.json.bak-YYYYMMDD` holds the old bytes.

## Companions

`companions/session-feed` (Claude Code / Codex sessions) and `companions/lcd-snap`
(pictures for a browserless screen) run next to chiketi; each has a README and is
configured by environment variables, so no deployment details live here.
`scripts/install-probe.sh` installs the Home Lab probe on a Linux host.

## Deploying

Use `chiketi-site` (`chiketi/sites/`) with a site folder (`examples/site/` is the
format; a real one lives in a private repo). It deploys a committed version (`git
archive` into a venv), never a live checkout, and generates every file it installs
from `chiketi/sites/templates/`. Never hand-edit generated files on machines: change
the template or the site and redeploy (`--dry-run` first). `/display` is the only
frameable page (kiosk wrapper pages iframe it).
