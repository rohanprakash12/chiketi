# Screen modes: Kiosk and Self, screens chosen per display

Status: approved in conversation 2026-10-23 (sections 1–4); this file is the written spec.

## Why

chiketi has two sets of screens that do not fit together:

- The **original screens** (System Stats, NPU/AI, Claude Usage, GPU, Clock) show the
  machine chiketi runs on. Every theme family has its own renderer for them.
- The **new Bridge Station screens** (Sessions, Home Lab) show the house. They share a
  header with a tab per area, drawn only for Sci-Fi/TOS and Others/Claude.

Today both sets are mixed into one rotation:

- The tab bar has no tabs for the original screens.
- The original screens are letterboxed on the 1920×462 LCD.
- A tap on a tab whose screen is switched off in the house-wide rotation list does
  nothing. That is how the Surface Go's Home Lab tab stopped working: the tab is drawn
  from `hlConfigured()`, not from the screens the display actually has.
- The registry exists four times: in `display_app.js`, `control_app.js`, the renderer
  harness, and the site generator.

## What changes

Each display gets a **mode** and its **own ordered list of screens**.

| Mode  | Screens (in order)                                                                 | Themes |
|-------|------------------------------------------------------------------------------------|--------|
| Kiosk | Overview, My Day, My Home, Home Lab, Sessions, AI Harness, GPUs                     | Sci-Fi/TOS, Others/Claude |
| Self  | System Stats, NPU / AI, Claude Usage, GPU, Clock (the original screens, unchanged)  | all 17 |

- In Kiosk, only **Home Lab** and **Sessions** are built. The other five are grey
  placeholders that can be ticked so their tab shows, but they never rotate in.
- Kiosk has no Clock tab, because the time is in the header.
- Terminal stays a Self-only family, with no clock (as today).
- The house-wide `screen_rotation` list goes away, along with its per-screen durations.
  Paired displays already ignored those durations.

Out of scope:
- the GPUs screen (next, with its own spec);
- Kiosk designs for other themes;
- a Terminal clock;
- red alert (device settings Phase 2) and the on-screen settings gear (Phase 3);
- a night/idle clock.

## 1. One description of the screens: `chiketi/assets/ui/screens.json`

The screen sets are data. Python reads the file to validate settings, and the server
inlines it into both pages as `SCREEN_SPEC`, as `panel_spec` is today. The harness and
the site generator load the same file.

```json
{
  "modes": {
    "kiosk": {"name": "Kiosk", "themes": ["Sci-Fi/TOS", "Others/Claude"],
              "default_theme": "Sci-Fi/TOS",
              "screens": ["overview", "myday", "home", "lab", "sessions", "harness", "gpus"],
              "defaults": ["lab", "sessions"]},
    "self":  {"name": "Self", "themes": "all", "default_theme": "Sci-Fi/TOS",
              "screens": ["screen1", "screen2", "screen3", "screen4", "screen5"],
              "defaults": ["screen1", "screen2", "screen3", "screen4", "screen5"]}
  },
  "screens": {
    "lab": {"name": "Home Lab", "label": "HOME LAB", "built": true,
            "color": "dRam", "needs": "homelab"},
    "...": "..."
  }
}
```

**Kiosk screen fields:**
- `name`: shown in the control panel.
- `label`: the tab text.
- `built`: whether the screen exists yet.
- `color`: a Bridge Station skin role such as `a2` or `dRam`, or a literal `#rrggbb`.
  Sessions keeps Claude coral `#D97757`.
- `needs`: a metric namespace whose `<ns>.status` must be available and not
  `unconfigured`, or `null` if the screen needs no data.

**Self screen fields:** `name` and `built: true`. They have no tabs.

**Screen IDs:**
- Kiosk IDs are the tab keys: `lab` and `sessions` replace `screen6` and `screen7`.
- Self keeps `screen1` to `screen5`.

**Renderers stay in JavaScript.** One resolver, `screenRenderer(id, family, variant)` in
`screen_functions.js`, returns `{fn, fluid}` or `null` when the theme has no such
screen (for example Terminal + Clock). Kiosk renderers resolve only for the Kiosk
themes. The TNG/DS9 Sessions and Home Lab wrappers are removed: they were recoloured
TOS, and those themes are not Kiosk themes now.

**One planner,** `screenPlan({mode, screens, family, variant})`, also in
`screen_functions.js`. The display, the control panel previews and the harness all
call it. It returns:

- `list`: the screens the display shows, in the order given. An ID is kept only if all
  of these hold:
  - it belongs to the mode;
  - it is built;
  - the resolver has a renderer for the theme;
  - its `needs` is met.
- `tabs` (Kiosk only): one entry per selected ID that belongs to the mode, in the same
  order, as `{id, label, color, built, live}`. `live` is true exactly when the ID is in
  `list`.

This replaces `getScreenRegistry()` ×2, the harness `REGISTRY`, the site generator's
`siteScreens()` and the hard-coded `bsTabList()`.

## 2. Device settings

Each approved display gains two settings:
- `mode`: `"kiosk"` or `"self"`;
- `screens`: an ordered list of IDs from that mode, with no duplicates. It may be empty.

**New displays:**
- A new display starts in **Kiosk** with the Kiosk defaults if the house has Kiosk data
  configured. Otherwise it starts in **Self** with the Self defaults. This refines
  section 1: on a stock install, Kiosk would only show an empty screen.
  - "Configured" means the config loads: `sessions.toml` passes the sessions
    collector's own loader, or `homelab.toml` passes `load_config()` with at least one
    host.
  - A missing, empty or malformed file does not count. Whether the feed is online does
    not matter.
  - It is worked out once at start-up (`kiosk_capable()`). A config change needs a
    server restart anyway.
- **chiketi's own screen:**
  - The kiosk browser that `chiketi` launches itself opens
    `/display?device=local`.
  - At start-up, when chiketi is going to launch its own kiosk (not `--no-kiosk`), the
    server makes sure the device `local` exists, approved, in **Self** mode with the
    Self defaults and auto-rotate on.
  - It is named after the machine's hostname and keeps its settings if it already exists.
  - It is identified by its device ID, not by the connecting address. The LCD's picture
    renderer (lcd-snap) also connects from localhost and must still pair.

**Validation (`devices.py`), whole request first, then apply:**
- `mode` must be a known mode.
- `screens` must be a list (at most 16 entries) of IDs that belong to the
  *resulting* mode, with no duplicates.
- **Changing `mode` without `screens`** gives the new mode's defaults, and clears a
  theme that the new mode does not allow.
- `theme` must be `""` or a theme allowed in the resulting mode.
- `mode` and `screens` are control-panel fields (`admin_update`). The display's own
  `POST /api/device/<id>` cannot change them.
- The field allowlist is applied first. For self-service, a `mode` in the body is
  ignored, and a `theme` is checked against the *stored* mode. A forbidden field can
  never cause an indirect reset.
- Any invalid field rejects the whole request, and nothing changes.

**The house theme per mode:**
- The existing house theme (`theme` in `state.json`, `POST /api/theme/…`) is the
  **Self** house theme.
- A new `kiosk_theme` is the **Kiosk** house theme:
  - stored in `state.json`;
  - set by `POST /api/kiosk-theme/<family>/<variant>`, which takes the same token as
    `/api/theme`;
  - reported by `/api/themes` as `kiosk_theme`;
  - it must be a Kiosk theme.
- **A display's theme** is resolved in this order:
  1. its own theme, if allowed in its mode and existing;
  2. otherwise its mode's house theme, if allowed;
  3. otherwise the mode's `default_theme`.

  So a Kiosk display can never land on Terminal or Vintage.

**`--rotate-interval`** now sets the starting seconds for new displays. Its default
becomes 30, the value displays already start with. The per-screen duration fields are
gone, so nothing else used it.

## 3. What a display does (`display_app.js`)

- **One committed render state.** `renderDisplay()` is the only place that turns
  settings into a screen. In one synchronous step it:
  1. resolves the theme (§2) from the current `device` settings and theme data;
  2. calls `screenPlan`;
  3. sets the tab state from `plan.tabs`;
  4. finds the current screen **by ID** in `plan.list`;
  5. draws it.

  Any change of settings (`chiketiApplyDevice`) or of theme data calls it. Nothing
  keeps an index into an older plan. Rotation, swipes and number keys rebuild the plan
  and step through `plan.list`; a tab tap navigates to an ID.
- **Settings arrive in order.** `pairing.js` numbers its device-status requests and
  drops a response older than the newest one already applied. A slow reply can never
  roll the display back to older settings.
- **Taps survive a redraw.** The display redraws every poll, and every second on a
  clock screen. A redraw can replace the tab under a finger between pointer-down and
  pointer-up. So:
  - the tab's ID is taken at **pointer-down**, from the pressed element's
    `data-screen`, together with the pointer ID;
  - on pointer-up with the same pointer and less than 12 px of movement, the display
    goes to that ID if it is still in the current plan, whatever element the pointer-up
    landed on.
- **Tabs (Kiosk):**
  - a tab is drawn for each selected screen, in order;
  - a `live` tab is coloured and carries `data-screen`;
  - a grey tab carries no `data-screen`, so tapping it does nothing;
  - a screen the display has not selected has no tab.

  Because the tabs and the list come from one plan, every coloured tab leads to a screen.
- **Attention colours** (amber or red when Sessions or Home Lab needs you) are unchanged.
- **New tab icons:** Overview and GPUs get their own art in `bsTabIcon`. The other five
  icons exist already.
- **The strip column** (the 1920×462 LCD) fits up to 5 tabs at today's size. Beyond
  that, the tab height and icon size shrink to fit the column.
- **Nothing to show:**
  - In Kiosk, an empty `plan.list` shows a notice in the theme's own chrome: the header
    (or strip frame) with its tabs, and the text "NO SCREENS TO SHOW · CHOOSE THEM IN THE
    CONTROL PANEL".
  - In Self, the display falls back to the first Self screen the theme has, as today.
- **The current screen** survives a change to the list when its ID is still there. A
  theme change still goes back to the first screen.
- **Rotation:** as today, a display uses its own `auto_rotate` and `seconds`, and a
  manual move pauses rotation for 30 s.
- **Self mode** renders the original screens unchanged, with no tab bar.
- `/api/display` no longer sends `screen_rotation` or `default_duration`.
- `screens.json` is part of the display build ID (`_DISPLAY_ASSETS` in `server.py`). A
  deploy that changes only the screen sets still makes open displays reload.

## 4. Control panel

- **The device bar is unchanged:** House defaults, the displays, then pending cards.
- **A display's card ("This display")** adds:
  - **Mode**: Kiosk / Self radio buttons. It applies at once, like a theme click; the
    server resets screens and theme as in §2, and the card redraws.
  - **Screens**: the mode's set, in the display's order (ticked ones first in their
    order, then the rest in set order). Each row has:
    - a tick box;
    - the name;
    - ↑/↓ buttons;
    - a status: *ready*, *coming soon* (not built), *not set up* (its `needs` is not met)
      or *not in this theme* (no renderer for the display's theme).
  - **Warnings** (they never block Save):
    - more than 5 ticked on a strip-shaped display: "the side column fits 5 at full size;
      icons will shrink";
    - nothing ticked that can show, in Kiosk: "this display will show 'No screens to
      show'".
  - **Save** sends `screens`, `auto_rotate`, `seconds` and `gear` together.
- **Theme picker:** with a display selected, it lists only the families and variants
  allowed in the display's mode. "House theme" follows the mode's house theme.
- **House defaults:**
  - A **Kiosk / Self** toggle chooses which house theme the picker sets: Self posts
    `/api/theme/…` and Kiosk posts `/api/kiosk-theme/…`.
  - The picker lists only that mode's themes.
- **Previews** show the screens from the selected display's plan (or the house mode's
  full set), with that plan's tabs.
- **The Settings tab** loses "Screen Rotation" and its Apply-time `screen_rotation`.
  Output, brightness and power stay where they are, renamed "This machine's screen".
  They only ever affected the screen attached to the chiketi server; moving them into
  the `local` display's card is left for later.

## 5. Saved state and migration

These run once, when the new version first starts:

- **Before anything is changed**, `state.json` is copied to `state.json.bak-YYYYMMDD`,
  unless that file exists already. This happens only if the file has old-format
  content: a device without `mode`, or a `screen_rotation` key.
- **A saved device without `mode`** becomes Kiosk with the Kiosk defaults if the house
  has Kiosk data configured, and Self with the Self defaults otherwise. (The Go and the
  LCD become Kiosk with [Home Lab, Sessions], keeping their name, rotation and theme.)
- **A device theme the resulting mode does not allow** is cleared to "follow house".
- **Saved `screens`** are filtered to valid, unique IDs of the mode. An entry with a
  bad `mode` falls back as if `mode` were missing.
- **`screen_rotation` is dropped, not converted.** It is the list that hid Home Lab on
  the Go.
- **`kiosk_theme` missing:** it becomes the house theme if that is a Kiosk theme,
  otherwise `Sci-Fi/TOS`.
- `STATE_VERSION` stays 1, because the change only adds fields.
- **A rollback loses the new fields.** An older chiketi loads the file fine and shows
  every screen, but its next save drops `mode`, `screens` and `kiosk_theme`. Upgrading
  again migrates the displays afresh to the defaults above.
  - To keep chosen screens across a rollback, copy `state.json` before rolling back and
    put the copy back after upgrading again.
  - The pre-migration backup restores the state as it was before this version.

## 6. Testing

- **pytest, `screens.json`:**
  - IDs are unique and the two sets do not overlap;
  - required fields are present;
  - defaults are subsets of their mode's screens;
  - every listed theme exists in `THEMES`;
  - every colour is a known role or `#rrggbb`.
- **pytest, devices:**
  - mode and screens validation (unknown ID, wrong mode, duplicates, non-list, too long);
  - a mode switch resets screens and an unsupported theme;
  - a request with one valid and one invalid field changes nothing;
  - the starting mode follows the house's Kiosk data, for missing, empty, malformed and
    valid configs;
  - the `local` device;
  - the display's self-service call cannot change mode or screens, and a self-service
    `{mode, theme}` body checks the theme against the stored mode;
  - state migration (old device, bad `mode`, `screen_rotation` dropped, backup made once);
  - the `kiosk_theme` route: validation, a token required when one is configured, and a
    foreign Origin rejected;
  - `/api/display` no longer carries `screen_rotation`;
  - changing only `screens.json` changes the display build ID.
- **Renderer harness:**
  - the registry comes from `screens.json` and `screenRenderer`;
  - every built screen renders in every theme of its mode, with every fixture, at
    every shape;
  - Kiosk renderers exist for every Kiosk theme, and Self screens 1–4 exist for all
    17 themes;
  - the "No screens" notice renders, landscape and strip;
  - tab bars with 1, 2, 5 and 7 tabs stay within the layout-px rules;
  - **regression for the Go bug:** for many plans, the `data-screen` values in the tab
    bar are exactly the IDs of `plan.list`, and no unselected screen has a tab.
- **Real browser:**
  - `fit_check.mjs` stubs pairing with an approved device and takes `CASES` as
    `<screen id>:<fixture>`, plus a `TABS` count. It runs at 1800×1200 and 1920×462 with
    2, 5 and 7 tabs.
  - `devices_check.mjs` gains steps:
    - switch a display's mode;
    - tick and reorder its screens and see the display follow;
    - **on a touch display, tap each live tab and see the screen change**;
    - a tap whose pointer-down and pointer-up straddle a forced redraw still navigates;
    - a grey tab does nothing;
    - a settings change reaches an open display without a reload, and keeps the current
      screen when it is still listed. The cases are a reorder, a mode switch with the
      same theme, and moving into and out of an empty Kiosk plan.
- **The site generator** uses `screenRenderer` for the Self set, and `docs/site` is
  regenerated.

## 7. Docs and rollout

- `CLAUDE.md`: the "registry exists three times" note becomes "add a screen through
  `screens.json` and `screenRenderer`".
- `README.md`: a short "Screen modes" section, and `--rotate-interval` reworded.
- `CHANGELOG.md`: an entry for the change.
- Rollout:
  1. Branch `screen-modes`.
  2. The plan, reviewed by Codex until approved.
  3. Build.
  4. The branch, reviewed by Codex until approved.
  5. `chiketi-site deploy server --dry-run`. Without `--dry-run`, the command deploys.
  6. Rohan's OK, then deploy.
  7. Check the Go (tap both tabs), the LCD (rotates through both) and the control panel.
