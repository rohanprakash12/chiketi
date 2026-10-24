# Kiosk looks: Home Lab, Sessions and GPUs in every theme

Status: written 2026-10-24 for Rohan's review. Builds on `specs/2026-10-23-screen-modes-design.md`
and `specs/2026-10-24-gpus-screen-design.md`.

## Why

The Kiosk screens (Home Lab, Sessions, GPUs) exist only in Sci-Fi/TOS and Others/Claude. Rohan
wants them in every theme, and each family drawn in its own idiom, not recoloured:
- **Sci-Fi:** each series' bridge consoles.
- **Terminal:** the classic recolours are one look; the distro boards are another.
- **Retro:** each look is one era and one kind of screen.

The design was settled over four mockup rounds, with notes on every screen. The mockups are
prototypes running on the real display engine, kept in the private site repo because they
show real hostnames.

**Success:** for each look, the built screens look the way the agreed mockup does, with the
same layout, type, colours, glow and parts. Shown the same data at 1024×600, the two are
indistinguishable side by side, and Rohan signs that off per phase. On the Go (3:2) they fill
the screen without bars.

## Scope

**In:**
- the three Kiosk screens in TNG, DS9, the six classic Terminal recolours, the four distro
  boards, Scanlines, Tubes and VFD;
- a full (landscape) layout for each, filling any landscape frame (576–770 units tall);
- the Tubes parts as rendered images, and the scripts that render them;
- the visual QA described below.

**Out:**
- **Strip layouts (1920×462):** the new looks are letterboxed on a strip, which is what a
  fluid screen without a strip layout does today. A strip mockup round comes later.
- **Changes to TOS or Claude:** Rohan approved TOS unchanged.
- **New data**, with two small exceptions, both described under "Up and health":
  - each Home Lab issue gains a `key` field, the internal condition key the rules already
    have; it is additive and backward compatible;
  - an HTTP host that answers with a status other than 200 gets its own key, `api`,
    instead of `down`. Its title is unchanged.

**Phases:** each phase has its own plan, Codex review, visual QA, sign-off and deploy (with
Rohan's OK, dry run first). The Go can use each phase before the next starts.

1. TNG, DS9, Terminal classic (6 recolours), Terminal distro (4 boards).
2. Scanlines, VFD.
3. Tubes. Rohan called its v4 design provisional ("still needs work"). Phase 3 starts with a
   short design pass if he asks for one.

## Rules every look follows

From Rohan's notes, applied across all looks:
- **Clock and date on every screen:** HH:MM, never seconds, plus the day and date. What is on
  screen does not change with the theme.
- **Menu at the top**, in each look's own idiom. The exception is TNG, where the LCARS sidebar
  is the menu.
- **Readable from a few feet on a 7–10 inch screen:** no small type for anything that matters.
- **No wasted space:** layouts are built for volume. Each must stay readable with 15 alerts
  and with 7 GPUs (the busy cases in the mockups).
- **Every host shows two things:** whether it is up (its probe or service is available), and its health.
- **Status colour is the worst state of any screen.**
  - Each screen's status is today's tab-attention rule (`bsTabAttention`): Home Lab crit or
    warn; Sessions needing input or offline; a GPU hot, throttling or critical.
  - It drives the DS9 top bar and the TNG elbow and top bar. Rohan asked for this ("if any
    of the screens have a warning or red alert").

## Integration contracts

**Enabling the themes:**
- Each phase adds its themes to the Kiosk allowlist (`screens.json` → `modes.kiosk.themes`)
  and to `KIOSK_RENDERERS`, in the same commit. It uses the canonical keys: the Retro family
  is `Vintage` in code (`Vintage/Scanlines`), and the recolours are `Terminal/cyan`
  `…/hacker`.
- Tests prove that a device can be set to each new theme in Kiosk mode, that the setting
  survives a reload, and that the display then draws that theme's renderers.

**Menus follow the plan:**
- Every look draws its menu from `screenPlan()`, never from a fixed list. That covers:
  - the selected screens, in the device's order;
  - live screens and inactive ones (selected but unconfigured or not built);
  - the planned grey tabs;
  - the attention marks.
- Terminal numbering follows that order: `0:lab 1:sessions …` and `¹ ² ³` are positions,
  not fixed names. TNG's sidebar buttons, DS9's chips, the Scanlines and VFD icon menus and
  the Tubes tab lamps do the same.
- The tab labels on the Tubes header plates are live lettering, not baked in.
- Edge cases covered by tests: one selected screen, all seven tabs, a reordered selection,
  and none selected (see below).

**Up and health:**
- **Up means the probe or service is available.** This is what Rohan asked for: blue when
  active, red when down or unpingable. The lamp is red while an open issue has one of these
  keys:
  - `down`: the SSH probe fails, whether there is no answer, the login is rejected, the host
    key does not match or the probe output is malformed; or the HTTP check cannot connect;
  - `gw`: the gateway does not answer on TCP 53.
  - A host that is up on the network but whose probe login fails therefore shows red. That is
    intended: its monitoring is down.
- **Not reachability:** an HTTP host that answers 401 or 500 is reachable but unhealthy. Its
  condition moves from key `down` to a new key `api` (title, severity and hold unchanged), so
  it shows as health, not as down.
- **Debounce:** the lamp follows the issue, so it inherits the existing hold and clear counts
  (`HOLD_DOWN`). It turns red when the Unreachable alert is raised, not on the first missed
  poll.
- **Health:** the host's `state` (`ok` / `warn` / `crit`), as today.
- **Unknown:** the lamps are unknown (dim and unlit, never green) while Home Lab is pending,
  and for any host whose `state` is `unknown` (a check that has not produced a result yet).
- **No older-server support:** the display and server always ship together, and open displays
  reload on a new build. So the renderer assumes issues carry `key` and does not guess from
  an empty list.
- **When data is stale:** both lamps keep their last values, dimmed, and the screen shows the
  stale marker the TOS screen already shows.
- A down host's health shows DOWN in TNG, and red in the looks that use lamps or colour.

**Status (attention):**
- One function, `kioskAttention()`, returns `'crit' | 'warn' | null` for each Kiosk screen.
  It uses exactly today's inputs and precedence in `bsTabAttention()`:
  - **Home Lab:** `crit` → crit; `warn` or stale → warn.
  - **Sessions:** offline, or any session waiting → warn.
  - **GPUs:** `gpuStatusColor`'s crit and warn, so cached readings that have gone stale are
    warn, not crit.
- `bsTabAttention()` is rewritten on top of it, keeping today's colours.
- The worst state covers the screens in the device's plan that are live. It drives the DS9
  bar, the TNG elbow and the Tubes tab lamps.
- Each look maps `warn` and `crit` to its own colours. The distro skins gain explicit `warnA`
  (amber) and `crit` (red) roles; today's `warn` stays, used as `crit` where it is red.

**Empty and degraded data** keep today's meanings in every look:
- **Sessions:** offline (with last update), pending, and an empty list.
- **Home Lab:** pending, stale and unconfigured. An unconfigured screen stays out of the
  plan, as today.
- **GPUs:** missing metrics show `--`, never 0 or a healthy lamp. Stale cached rows are
  dimmed, with their age. Incomplete inventory and partial power totals are labelled as today.
- **Nothing selected:** each look draws the "no screens to show" notice (`kioskNotice`) in
  its own idiom, instead of falling back to TOS.

**Order and overflow:**
- Alerts are always ordered critical first, then oldest first, which is today's `issues()`
  order. No look re-sorts them.
- Each look shows as many as fit, then `+N MORE`. The visible ones are always the first in
  that order.
- **Permitted differences in presentation:** every look counts every alert, but they group
  them differently.
  - The distro boards group by host: each host's worst alert plus a count of the rest.
  - TNG groups GPUs by host. A group's rows are worst first, and groups are ordered by their
    worst GPU.
- **Capacities at 576 units**, the shortest landscape frame. Each look must show at least:
  - Home Lab: 8 alerts in full;
  - Sessions: 5 sessions;
  - GPUs: 8 cards;
  - then `+N MORE`. Taller frames show more, except where noted below.
- **Exceptions:**
  - The distro boards' Home Lab is a host summary. Its capacity is every host (up to 12),
    each showing its worst alert and `+n` for that host's others.
  - Tubes has fixed capacities, and its parts grow in taller frames:
    - Home Lab: 4 large fault windows, or 16 compact ones in two columns of 8;
    - Sessions: 5 rows;
    - GPUs: 8 bays.
- **What `+N MORE` counts:** the hidden items of the same kind (alerts, sessions, GPUs, or
  hosts on the distro summary).
- `fit_check` verifies no overflow at 576, 600, 683 and 770 units with the busy fixtures.

**Skins and theme switching:**
- Each Kiosk renderer sets the skin it needs on entry, as an immutable kiosk variant built
  from today's skin (`Object.freeze`d copies). Examples are the Scanlines brightness and
  raster variants.
- Shared skin objects are never changed, so Self screens and TOS/Claude Kiosk screens are
  unaffected.
- **A golden test pins today's output:** the harness records a hash of every existing
  renderer (Self, plus the TOS and Claude Kiosk screens) for each fixture before the change.
  The output must stay identical, apart from the attention refactor, whose colours are
  asserted unchanged.
- **Theme-switch sequences** (A→B→A across families) must give the same output as rendering
  A fresh.

## The looks

Each item is what the agreed mockup shows. The plan cites the prototype function as the
reference for every detail not written here.

### TNG (LCARS)
- **Frame:**
  - The top-left elbow and a thin top bar take the status colour: lilac when fine, yellow on
    a warning, red on an alert.
  - The clock is the big readout inside the elbow, with the short date under it.
  - The screen title (SHIP STATUS, CREW SESSIONS, GPU STATUS) is small, at the top right.
  - The sidebar tabs carry no numbers: gold for the active tab, peach or red when its screen
    needs attention, lilac otherwise, dim for planned screens.
  - The bottom bar carries each screen's summary segments.
- **Home Lab:** one row per system.
  - A left cap: blue when up, red when down.
  - The name.
  - A right health cap, all caps the same width: HEALTHY / WARN n / ALERT n / DOWN.
  - Alerts are grouped under SYSTEMS / ALERTS headers: big rows up to 4, two compact columns
    up to 16, then +N MORE.
- **Sessions:** rows with a state cap, name, project, a status pill, tokens, agents and time.
- **GPUs:** grouped by host. Each row shows GPU and model, a state pill, LOAD and VRAM bars,
  temperature (MEM under it) and power.

### DS9
- **Frame:** the v1 DS9 layout, plus a full-width 6-unit status bar at the top: teal when
  fine, amber on a warning, red on an alert. Tabs are angled chips with triangles; the clock
  is at the top right with the day and date.
- **Home Lab:** OPS · STATION on the left (condition word, counts, host chips); ALERTS on the
  right (cards up to 4, compact one-line rows beyond).
- **Sessions:** angled cards.
- **GPUs:** an array summary on the left; rows on the right that go compact with 7 cards.

### Terminal: classic (cyan, amber, phosphor, red_alert, blue, hacker)
- A tmux-style status line at the top: windows `0:lab 1:sessions 2:gpus` with the current one
  highlighted and `#` marking attention, plus day, date and time.
- Base text about 19 units. Panels sized to their content.
- Each recolour uses its own palette (`themeData` colours). Layout and type are identical
  across the six.

### Terminal: distro (Arch, Ubuntu, openSUSE, Mandriva)
- btop-style numbered tabs at the top (¹ lab ² sessions ³ gpus …), with the current one
  filled and amber marking attention.
- IBM Plex Mono at 19–21 units, in each board's `DISTRO_SKINS` colours.
- Hosts have up and health columns. With 15 issues, each host shows its worst issue plus a
  count of the rest.

### Scanlines
- **Built on today's Scanlines skin:**
  - Share Tech Mono, the phosphor glow and today's top menu with icons.
  - Yellow for warnings; phosphor green dominant, with blue, green and amber used sparingly.
- **v3 brightness:**
  - The content is lifted about 18 %, the glow is stronger and the vignette is lighter.
  - Scanlines are finer: a 3-unit pitch at about two-thirds of today's strength on Home Lab
    and Sessions.
  - The GPU screen, which has the smallest type, gets the finest lines: a 2-unit pitch at
    about 40 % strength.

### VFD
- Today's VFD skin: Share Tech Mono, its colours and glow, and its faint filament overlay.
- Lit legends for the tabs and states. The day and date sit under the clock.
- Unchanged since v2; Rohan said "good for now".

### Tubes
- **The look:** a 1940s–50s metal instrument panel, from Rohan's reference photos.
  - Rendered parts: black wrinkle-finish steel; raised hammertone plates with slotted screws;
    cream painted lettering; bakelite name plates with brass rivets; chrome-bezel jewel pilot
    lamps; IN-12 Nixie tubes seen end-on, in escutcheons; INS-1 neon colon lamps; IN-13
    bargraph tubes; chrome magic-eye mounts with glass domes; backlit annunciator windows
    with frosted glass.
  - No overlay of any kind.
- **Live light, drawn by today's code between each rendered back and front layer:**
  - **Nixie numerals:** the bundled Antonio at weight 100, sized and placed from measured
    metrics so they land on the rendered wire cathodes, in deeper amber-orange.
  - **IN-13 glow:** today's four `tubeFilament` glow layers. Green and blue are more
    saturated, with tinted cores.
  - **Magic eye:** today's `magicEye` phosphor.
- **Home Lab:**
  - Three condition lamps (NORMAL, CAUTION, ALERT).
  - Each station has an up lamp, a health lamp and a name plate.
  - HOSTS and FAULTS are Nixie numbers, and the clock and SINCE times are Nixie too.
  - Faults are annunciator windows: amber for a warning, red for critical. Compact two-column
    strips when there are many.
  - The date is on a warm-white lit window beside the clock.
- **Sessions:**
  - Each row has a lamp and a backlit name window: amber needs input, warm white working,
    green shell, dark idle.
  - Tokens, agents and running time are Nixie numbers; an unlit tube means none.
- **GPUs:**
  - Each card is a module with a name plate, a magic eye for load, the temperature in Nixies
    (MEM under it), IN-13 tubes for VRAM (blue) and power (orange, green when idle), and a
    state lamp.
  - With 5–8 cards there are two rows of smaller modules, and an unused bay is a blank plate.
    More than 8 shows a +N line.

## Geometry

- **Design size:** layouts are designed at 1024×600 frame units, the mockup size. In a taller
  landscape frame (up to 770 units, the Go is 683), the extra height goes to the parts that
  grow:
  - alert lists and session rows;
  - GPU rows and modules;
  - the fixed header and footer stay the same size.
- **Units:** everything is in `gq()` units (the harness rule). The prototypes use px at
  1024 wide, so a prototype `n` becomes `gq(n)`.
- **Effective height:** one helper, `kioskH()`, gives the height that layout, image choice and
  frame classification all use:
  - a `landscape` frame: its height (576–770);
  - anything else: 600.
  - No layout uses raw `frameH()` or `fluidH()` directly.
- **Strip and other shapes:**
  - The new looks' renderers are marked landscape-only (`fluid: 'landscape'`).
  - The display and the control-panel previews letterbox them in a 1024×600 frame whenever
    the shape is not landscape, for `strip` and `other` alike.
  - Today only `strip` drops the fluid class (`display_app.js`). The new rule applies to
    landscape-only renderers, so TOS and Claude keep their current behaviour.
- **Tubes panels** are rendered per height, for heights in {576, 600, 620, 640, 660, 683,
  700, 720, 745, 770}:
  - the screen uses the largest height that does not exceed `kioskH()`;
  - any leftover (at most 24 units, from 720 to 744) is filled with plain panel steel at the
    bottom;
  - every live part's position comes from the same height.
- **The Tubes panel variants** are finite and listed in a manifest:
  - `lab`: 9 station slots; extra hosts show `+N`; empty slots are blank plates.
  - `sessions`: 5 rows; empty rows show a dark window.
  - `gpus4`: up to 4 cards.
  - `gpus8`: 5–8 cards; unused bays are blank plates.
  - Each variant is rendered at every height: 4 variants × 10 heights.
- **Only the plates are baked.** The fault windows, session windows, lamps, tubes and eyes are
  separate live images, placed at runtime by the shared layout module. That covers both fault
  arrangements (4 large, or 2 × 8 compact) without extra panel variants.
- **Only fixed legends are baked:** CONDITION, STATIONS, FAULT REGISTER, TOKENS and the like.
  Names, tab labels, titles with counts, values and every data string are live lettering,
  passed through `esc()`.
- **Placement:** the plates, label plates and slots come from one layout description, which
  both the Blender render and the renderer read, so the parts land on their plates.

## Tubes assets

- **Scripts:** the Blender scripts live in `tools/tube-renders/` (public, no house settings).
  They need Blender 4.5 LTS with Cycles, and run on any machine set by an environment
  variable (a GPU host makes them quick). The reference photos stay private.
- **Output:** `chiketi/assets/tubes/`, as WebP with alpha, at 2× the largest size used, plus
  `manifest.json` (every file, its size and the layout hash).
- **Budgets:**
  - files about 4 MB in total;
  - decoded images held at once (the preloaded plan screens plus the instruments) under
    120 MB. One panel is 2048 × up to 1540 × 4 bytes, about 12.6 MB.
- **Serving:**
  - **Route:** a new bounded route, `/assets/tubes/<name>.webp`. It serves only names listed
    in the manifest, with MIME `image/webp`.
  - **Cache:** URLs carry the manifest hash (`?v=<hash>`), and responses are cached for a long
    time.
  - **Reload:** the manifest hash is part of the display build hash, so a deploy reloads open
    displays with matching coordinates and plates.
  - **Missing images:** unknown names return 404. The renderer draws a plain dark plate if an
    image fails, never a broken image.
- **Licence:** the renders are our own work, released with chiketi. The fonts used (IBM Plex
  Mono, Antonio, Nixie One) are already bundled under the OFL.
- **Regenerating:** one documented command re-renders everything. A test fails if:
  - any file listed in the manifest is missing;
  - the layout the renderer uses (`TUBES_LAYOUT`, generated from the same `layout.py`)
    hashes differently from the manifest.

## Performance (the Go is a Surface Go 1)

- **Watch-points:** Tubes and Scanlines are the heaviest looks, with stacked images, blend
  modes and SVG blur filters. A redraw must stay smooth on the Go.
- **What a warm redraw is:** the time from `renderDisplay()` starting to the second
  `requestAnimationFrame` after `innerHTML` is set, with the screen's images already decoded.
  The display preloads and `decode()`s only the Tubes images for the current `kioskH()`
  height and the screens in the device's plan: at most 3 panels plus the shared instrument
  images. It does this again when the height or plan changes, or when the GPU count crosses between `gpus4` and `gpus8`. References to the images it no longer needs are released.
- **What cold readiness is:** measured separately, once per screen, with the browser cache
  cleared and the preload turned off. It runs from the first render to every image on screen
  having `decode()`d.
- **How it is measured:** on the Go, with the busy fixtures (15 alerts, 7 GPUs, 6 sessions),
  20 redraws per screen per look.
- **Budget:**
  - warm redraw: median ≤ 150 ms, 95th percentile ≤ 300 ms;
  - cold readiness: ≤ 1.5 s per screen;
  - memory: Chromium's renderer process grows by less than 50 MB over 60 minutes of tab
    rotation.
- **Tubes is measured early:** phase 3 starts by measuring one Tubes screen (Home Lab, one
  panel) on the Go, before the full asset set is rendered.
- **If a look is over budget:** keep the static layers between redraws. That changes
  `display_app.js`, which today replaces all of `innerHTML`, so it would be a separate change
  with its own approval.

## Visual QA (how "exactly as agreed" is checked)

1. **Gates:** pytest, the render harness, `check_js`, ruff and `fit_check`. They are
   extended so they actually cover the new themes:
   - **Kiosk themes are discovered from `SCREEN_SPEC`**, not hard-coded. This applies to the
     harness plan tests, the GPU checks and `fit_check`.
   - **Semantic checks are keyed to screen IDs** (`lab`, `sessions`, `gpus`), not to
     renderer function-name suffixes.
   - **Physical shape is separate from the layout drawn:** a full layout letterboxed on a
     strip is checked as full. For example, MEM lines are allowed there.
   - **The shape sweep runs every Kiosk fixture**, including the HOSTILE, offline, pending,
     stale, empty and busy fixtures. It covers shapes 1024×600, 1800×1200, 1920×462, a
     576-unit landscape, a 770-unit landscape and an `other` shape.
   - **Plan edge cases** (one tab, seven tabs, reordered, none) and the theme-switch
     sequences above.
   - **Images:**
     - the harness px rule applies to every inline size, and images are sized only with
       `gq()`;
     - **hostile payload:** the HOSTILE fixture's payload moves from `<img …>` to a tag no
       renderer emits (`<video src=x onerror=…>`). The vocabulary guard and the `esc()` rule
       stay as they are;
     - **image tags:** every `<img>` a renderer emits, in clean and hostile renders alike,
       must have a `src` that is a manifest URL under `/assets/tubes/`, and only the
       attributes `src`, `alt`, `style` and `class`;
     - `fit_check` asserts that every image loaded (`complete && naturalWidth > 0`);
     - the control-panel previews are checked to render each new look.
   - **Magic eye:** `magicEye()` today writes its label unescaped, and builds its SVG ids from
     the label, so two eyes with the same label share ids.
     - It gains an `id` option, a unique deterministic prefix (for example `eye-gpus-3`),
       separate from the visible label.
     - The label is escaped.
     - The Tubes screens pass an empty label and a unique id.
   - **Deterministic renders** for the golden hashes and A→B→A comparisons:
     - `Date` is frozen to a fixed instant before the fixtures load, with TZ=UTC;
     - `Math.random` is replaced by a seeded generator, reset before each render being
       compared.
2. **Parity with the mockup:**
   - A tool in the private site repo renders each agreed prototype and the built renderer
     side by side in a real `/display`. The prototypes are pinned to their commit
     (`design/kiosk-looks/v4/proto`, plus the IN-12 change).
   - Both are rendered with the same data, the clock frozen, CSS animations and transitions
     disabled, and fonts and images fully loaded before capture.
   - It makes a page per look and screen: mockup, build and a difference heat map, plus the
     share of pixels that differ.
   - Any region that differs by more than 0.5 % of its pixels (at a tolerance of 8/255 after
     a 1-unit blur) is either fixed or listed on the page with the reason.
   - The page is then published for Rohan's sign-off, which is the gate for "looks exactly as
     agreed". The public harness fixtures are the reproducible functional baseline.
3. **On the device:** after the dry run and deploy, screenshots from the Go itself for every
   new look and screen, at 3:2, are added to the same page.

## Risks

- **Fidelity to the prototypes:** they use px and fixed positions, and porting them to `gq()`
  and fluid heights can drift. The parity pages catch it.
- **Tubes on the Go:** image decoding and blend modes may be slow. See Performance above.
- **Public repo:** fixtures, specs and assets use neutral names. Mockups with real hostnames
  stay private.
