# Per-device settings and red-alert takeover: design spec

- **Date:** 2026-10-21
- **Status:** Approved by the owner, 2026-10-21 ("this sounds good but I wonder if it will work, let's go
  ahead"). It is therefore built in three phases, each usable on its own (see Phases).
- **Branch:** `feat/homelab-screen` (the kiosk-deploy work continues there)

## Why

chiketi now drives more than one display from one server (chiketi-server): the Surface Go (touch,
1800×1200) and the 9.3" Lcdhost LCD (no touch, 1920×462 pictures). Today every setting is
server-wide and changed only from the web control panel. The displays need different
behaviour: the owner changes screens on the Go by hand, while the LCD has to rotate on its own.
And when something is in red alert, every display should show it.

## Decisions (the owner, 2026-10-21)

1. Settings are **per device**, and editable in **two places**: on the device itself (touch)
   and in **chiketi's existing control panel**, which becomes the central hub: a device
   drop-down at the top switches the whole panel to that device. Any display that opens
   chiketi registers itself as a device.
2. Per-device settings in the first version: **auto-rotate on/off with seconds per screen**,
   and **theme**. All devices show the same set of screens.
3. On-device settings have **no lock**: anyone at the Go can change the Go's own options.
4. The screen **stays where it was put**. There is no idle return to a home screen.
5. **Red alert takes over** on every device, including the LCD: while any screen is red, the
   device shows that screen; with two or more red screens it rotates among them. When red
   clears, the device goes back to where it was. If someone swipes away during red, the device
   holds there for **5 minutes**, then returns to the red screen(s) if still red.
6. Yellow (amber) never switches screens; it only colours the tab, as today.
7. Not in this version: brightness and night dimming, and different screen sets per device.
8. **New displays pair.** A display chiketi has not seen shows a pairing code and no dashboards
   until it is approved in the control panel. The Go and the wide LCD pair once too, as the first
   test of the flow.
9. chiketi **detects what each display can do** (size and shape, touch, browser, live browser or
   picture feed) and uses it for the starting settings and to refuse browsers that are too old.

## Device identity and pairing

### Ids
- Every display has an id of 1–32 characters of `a-z 0-9 -`:
  - kiosks pin theirs in the URL they load, `/display?device=<id>`: the Go's `shell.html` uses
    `kiosk-1`; chiketi-server's `lcd_snap.py` uses `wide-1` (the 9.3" wide LCD);
  - any other browser gets a random id (`display-` + 6 characters), generated once and kept in
    its local storage. If local storage is unavailable, the id lasts until the page reloads.
- A display whose browser is too old to report anything (see Capabilities) cannot register.

### Pairing
- An id chiketi-server has not approved is **pending**. Its display shows the **pairing page**
  instead of dashboards: "NEW DISPLAY", a 4-character code (alphabet without 0/O/1/I/L, shown
  as `K7-42`), "Approve in the chiketi control panel at <server address>", and the detected
  capabilities (for example "1800×1200 · 3:2 landscape · touch · Chrome 155"). It is drawn in
  the house theme and also renders at the strip shape, so the wide LCD can show its code.
- The control panel lists pending displays under **New displays** with code, IP, capabilities and
  first seen. **Approve** asks for a name and creates the device record with starting settings
  from its capabilities; **Reject** drops the request and the display gets a new code.
- Approval is stored on chiketi-server by id: a kiosk with a pinned id stays approved through
  reboots and wiped browsers; a random-id browser whose storage is wiped pairs again as new.
- **Forget** (control panel) removes the device; its display returns to the pairing page.
- Pending requests not seen for 24 hours are dropped; at most 16 can be pending.
- **Security note** (accepted by the owner): pairing keeps the device list tidy and intentional;
  it is not access control. `/api/metrics` and `/display` stay readable on the LAN, as today.

### Capabilities
- The display page reports, on registration and whenever they change (rotating a tablet):
  - `w`, `h`: viewport in CSS pixels, and `dpr`; from these the layout class (`landscape`,
    `strip`, or `other` = "no layout yet", shown centred and never cropped);
  - `touch`: `navigator.maxTouchPoints > 0` or `matchMedia('(pointer: coarse)')`;
  - `browser`: name and major version from the user agent;
  - `feed`: `live` (a browser) or `picture` (set by a renderer such as `lcd_snap.py`, via
    `?feed=picture`).
- **Minimum browser:** chiketi's scaling needs CSS container queries: Chrome/Edge 105+,
  Safari 16+ (iOS/iPadOS 16), Firefox 110+. The pairing page is written in plain ES5 with no
  container queries, so it runs on older browsers and says "This browser is too old: needs
  Chrome 105+, Safari 16+ or Firefox 110+" instead of a broken screen.
- **Starting settings on approval:** touch → auto-rotate off and the gear tab shown;
  no touch or a picture feed → auto-rotate on (30 s) and no gear tab. All editable afterwards.
- Screens with no browser (the LCD) are shown through a renderer on chiketi-server, which registers
  on their behalf; each new kind of such screen needs its own small renderer.

## Server

### State

`state.json` gains `devices`: `{ "<id>": { "auto_rotate": bool, "seconds": int,
"theme": "<Family/Variant>" | "" , "name": str, "gear": bool, "caps": {...} } }`, approved
devices only. Pending requests live in memory (they are cheap to recreate).
- `theme` empty means "use the house theme" (the existing server-wide theme).
- `seconds` is clamped to the existing rotate bounds (3–600); default 30.
- `name` is an optional friendly label for the central page ("Surface Go", "9.3in LCD").
- Unknown keys are dropped; a malformed entry is dropped, never fatal (the same rule the
  state loader uses today). At most 32 devices are kept.

### API

- `POST /api/register` (display page; no token, same-origin checks) with `{id, caps}`.
  Returns either `{status: "pending", code}` or `{status: "approved", settings}`. Called on
  load and whenever capabilities change; also refreshes `last_seen` and the address.
- `GET /api/device/<id>` (polled with the other APIs) returns `{status, code?}` or the
  approved device's effective settings `{id, name, auto_rotate, seconds, theme, gear}`, and
  refreshes `last_seen` (in memory; not written to disk on every poll).
- `POST /api/device/<id>` changes `auto_rotate`, `seconds` and/or `theme` of an **approved**
  device, from its own Settings screen. **No token** (decision 3), but the existing same-origin
  protections apply (matching `Origin`, allowed `Host`), so another web page cannot change it.
- Control panel (token required, as every control-panel write today):
  `GET /api/devices` (approved and pending, with last seen, address and capabilities),
  `POST /api/devices/<id>/approve` `{name}`, `POST /api/devices/<id>/reject`,
  `POST /api/devices/<id>` (any field, including `name` and `gear`),
  `POST /api/devices/<id>/forget` (the server has no DELETE handler; POST keeps the existing
  Origin and token checks).

## Display (`display_app.js`)

- On load it registers (id from the URL or local storage, plus capabilities). While pending it
  shows the pairing page and polls `/api/device/<id>` until approved. Once approved, each
  poll also fetches `/api/device/<id>`:
  - `theme` (if set and known) overrides the house theme for this display only.
  - `auto_rotate` / `seconds` drive `scheduleRotate()` in place of the server-wide rotation
    timing. Which screens are enabled still comes from the server-wide rotation config.
- Manual navigation (swipe, tab tap, keys) is unchanged.

### Red alert

- Each registry entry may carry `alert()`, returning `'red'`, `'amber'` or `null`. Home Lab:
  `'red'` for `crit`, `'amber'` for `warn`/`stale`. Sessions: never red (`'amber'` while a
  session waits on input). Later screens (Home, …) add their own.
- On every render the display computes the red screens:
  - none red → normal behaviour;
  - one or more red, and no active swipe-away hold → show only the red screens, rotating among
    them every `seconds` if there are two or more (regardless of `auto_rotate`);
  - the user swipes or taps away during red → hold where they went for 5 minutes, then
    return to the red screen(s) if still red;
  - red clears → back to the screen the device was on before red began.
- The LCD has no input, so it simply follows the red screens.

## On-device Settings screen

- A **gear tab** after the five screen tabs (full layout and strip layout). Tapping it opens
  Settings; it is not part of rotation, and shows only on devices whose `gear` is on.
- Same chrome as the other screens (status line, tabs, date and clock). Large touch targets.
  Contents:
  - **Auto-rotate**: an on/off toggle, and seconds per screen (− / + in steps of 5, 5–600).
  - **Theme**: one swatch per theme, plus "House theme". The current choice is lit.
  - **This device**: the id (and name, if set), read-only.
- Changes are sent with `POST /api/device/<id>` and take effect on the next poll (≤ 2.5 s).
- Every Sci-Fi and Others/Claude variant renders it; Terminal and Vintage are out of scope,
  as for the other kiosk-deploy screens.

## Central hub: the control panel

- A **device drop-down** at the top of the existing control panel: "House defaults" first, then
  every registered device by name (or "New display (<IP>)"), each with online/last seen
  ("12 s ago"; "offline" after 2 minutes).
- Picking a device **scopes the panel to it**: the theme picker, auto-rotate and seconds per
  screen edit that device, and the preview takes that device's shape (3:2 for the Go, the strip
  for the LCD, from the frame size the display reports on each poll). "House defaults" edits the
  server-wide settings, as the panel does today.
- Per device the panel can also **rename** it and **forget** it.
- Which screens are on stays house-wide (all devices show the same set); with a device
  selected, that list is labelled "All devices".
- Writes need the token, as every control-panel write does today. This is how the LCD's
  settings are changed.

## Phases

Each phase is deployed and tried before the next starts.
1. **Registration, pairing and the control-panel hub:** ids, capabilities, pairing page,
   approve/reject/forget, device drop-down, per-device theme and auto-rotate/seconds. The Go and
   the wide LCD pair through it. Removes `?rotate=off`.
2. **Red-alert takeover** on every device.
3. **On-device Settings** (gear tab) on touch displays.

## Rollout

- `shell.html` on the Go: iframe `…/display?device=kiosk-1` (back up first).
- `lcd_snap.py`: `LCD_URL` `…/display?device=wide-1`.
- Both then show their pairing codes; the owner approves them in the control panel as "Surface Go"
  and "9.3in wide LCD". Their capabilities give the Go auto-rotate off and the LCD
  auto-rotate on, 30 s.

## Testing

- **pytest:** pairing (register → pending with a code; approve → settings; reject → new code;
  forget → pending again; 24 h expiry; cap of 16 pending; code alphabet); capability parsing
  and starting settings; device-id validation; state load/save round trip with `devices` (malformed
  entries dropped, cap of 32); `GET /api/device` creates defaults and records `last_seen`;
  `POST /api/device/<id>` accepts only its three fields, clamps `seconds`, rejects unknown
  themes, and rejects a foreign `Origin`; `/api/devices` writes need the token.
- **Control panel:** a real-browser test that picking a device changes what the theme and
  rotation controls show and save, and that "House defaults" still edits the server-wide
  settings.
- **JS harness:** the pairing page (pending, too-old browser, hostile caps strings) at full and
  strip shapes; the Settings screen in every Sci-Fi and Claude variant, full and strip
  shapes, escaping of device id and name (hostile fixture), no layout px.
- **Red-alert logic:** a pure function `redPlan(screens, state, now)` tested with fixtures in
  the harness: none red, one red, two red, swipe-away hold expiring, red clearing.
- **Real browser:** fit check of Settings at the Go and LCD shapes; a swipe test that the Go
  stays put with auto-rotate off; a red-alert test that both devices switch to Home Lab and
  return when it clears (live, by filling a scratch filesystem on chiketi-server as before).
