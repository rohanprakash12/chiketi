# Kiosk Looks, Phase 3 (Tubes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Kiosk screens (Home Lab, Sessions, GPUs) in Vintage/Tubes: a rendered 1940s–50s instrument panel with live Nixie numerals, IN-13 bargraphs, magic eyes, jewel lamps and annunciator windows, looking the way the agreed v4 mockup does (with Rohan's IN-12 digits), filling every landscape height, fast on the Surface Go.

**Architecture:**
- **Renders (public scripts, `tools/tube-renders/`):** `layout.py` is the one description of every Tubes screen, parametrised by frame height; Blender scripts render the panels (plates, screws, fixed legends, blank label plates) per variant and height, and the instrument parts once. `pack.py` turns the renders into WebP, writes `chiketi/assets/tubes/manifest.json` and generates `chiketi/assets/ui/tubes_layout.js` (`TUBES_LAYOUT`, `TUBES_HASH`, `TUBES_FILES`). One command, `tools/tube-renders/render.sh`, re-renders everything on the host named by `TUBE_RENDER_HOST` (a GPU host with Blender 4.5 LTS at `TUBE_BLENDER`).
- **Serving:** a bounded route `/assets/tubes/<name>.webp` serves only manifest names (`image/webp`, long cache, `?v=<hash>` URLs); the manifest hash joins the display build hash.
- **Renderers (`kiosk_retro.js`):** `tubHomelab`, `tubSessions`, `tubGpus`, `tubNotice` place the live parts on the rendered panel from `TUBES_LAYOUT[variant][height]`. The display preloads and `decode()`s the images the plan needs.

**Tech Stack:** Blender 4.5 LTS (Cycles, OptiX) on a GPU host; Python (Pillow for WebP, pytest); browser JS; Playwright (fit_check, preview_check, devices_check, parity, on-device timing over CDP).

**Spec:** `specs/2026-10-24-kiosk-looks-design.md` ("Tubes", "Geometry", "Tubes assets", "Performance", "Visual QA").

**Reference (private, not copied):** `../chiketi-private/design/kiosk-looks/v4/`: `blender/{layout,panel,parts,tubes,in12}.py`, `proto/tub4.js` (`jewel4`, `nixie4`, `neon4`, `nixieRow`, `in13`, `eye4`, `ann4`, `paint4`, `plateText`, `tubFrame4`, `tubLabV2`, `tubSessionsV2`, `tubGpusV2`). Every visual value not written here comes from there, px turned into `kq()`.

**Measured first (spec "Tubes is measured early"), 2026-10-25, the v4 prototype in the Go's own Chromium over CDP:** warm redraw median 34 ms (Home Lab), 42 ms (Sessions), 67 ms (GPUs); p95 50 / 87 / 111 ms (budget 150 / 300). Cold readiness 1.6–1.9 s with the v4 PNGs relayed over an SSH tunnel; re-measured with the real WebP assets from the chiketi server in Task 7 (budget 1.5 s).

## Global Constraints

- Public repo: neutral names only. The reference photos and mockups stay private; the Blender scripts carry no house settings (host, paths and Blender location come from environment variables).
- Harness rules: no layout `px` over 2 (everything `kq()`), every data string through `esc()`, FULL defines every metric read, no `undefined`/`NaN`.
- Images: every `<img>` has a `src` that is a manifest URL under `/assets/tubes/` with `?v=<TUBES_HASH>`, and only the attributes `src`, `alt`, `style`, `class` (the harness rule already in place). `alt=""`; the part's container carries a dark plate background so a failed image shows a plain plate, never a broken-image icon. CSS `border-image` (annunciator windows) uses the same URLs.
- Only fixed legends are baked (CONDITION, STATIONS, FAULT REGISTER, HOSTS, FAULTS, TOKENS, AGENTS, RUNNING, LOAD, CORE TEMP, the screen titles, CHIKETI INSTRUMENT CO.). Names, tab labels, counts, values and every data string are live lettering.
- Heights: `TUBES_HEIGHTS = [576, 600, 620, 640, 660, 683, 700, 720, 745, 770]`; a screen uses the largest height ≤ `kioskH()`; leftover (at most 24 units) is plain panel steel (`#0b0a09` plus a 1-unit top shadow) under the panel.
- New renderers: `bsFrame(body, 'landscape', 'Vintage/Tubes')`, registered with `fluid: 'landscape'` and `notice`; frame root `font-size:kq(16)`; `data-status="<kioskWorst()>"`.
- Capacities (spec "Exceptions"): Home Lab 4 large fault windows or 16 compact (2 × 8; past 16, 15 and a `+N MORE` window); 9 station slots (past 9, 8 stations and a `+N HOSTS` plate); Sessions 5 rows then `+N MORE` in the footer; GPUs 8 bays (`gpus4` up to 4, `gpus8` 5–8, past 8 a `+N MORE` line).
- Golden: existing hashes never change; `GOLDEN=update` only adds.
- Commits end with the Co-Authored-By and Claude-Session lines. Don't run `ruff format`.

## Review Focus

1. A failed or missing image (a 404, or an old cached manifest after a deploy) shows a plain dark plate and the live parts still read; it never shows a broken-image icon or shifts the layout. Harness: an image never lacks its plate container; fit_check: every image loaded.
2. A frame height between two rendered heights (e.g. 730) uses the 720 panel with 10 units of steel below, and every live part lands on its plate (positions come from the same layout as the render). Harness: `tubPanelH(h)` for every integer height 576–770; parity at 600 and Go screenshots at 683.
3. Ten hosts, twenty alerts, nine GPUs and seven sessions: `+N HOSTS`, `+N MORE` windows/lines with exact counts, nothing silently dropped. Harness LOOKS with the Tubes capacities.
4. Hostile strings in host names, titles, session names/messages and GPU models stay text on label plates and in windows (plate text shrinks to fit but is escaped first). HOSTILE sweep.
5. Theme switches Tubes → TOS → Tubes, and Tubes beside the Self Tubes screens (which use `magicEye` and `tubeFilament` too), give identical output and leave the shared skin untouched; two magic eyes never share SVG ids. Harness switch and id checks.

---

### Task 1: `magicEye` id option and escaped label (spec "Magic eye")

**Files:** `chiketi/assets/ui/screen_functions.js` (`magicEye`), `tests/js/render_harness.js`.

- `magicEye(pct, label, size, opts)` gains `opts.id`: when given, every SVG id it writes is built from it (`'me-' + id + '-…'`) instead of from the label; the visible label goes through `esc()`. Without `opts.id` the ids stay as today, so every existing render (golden) is byte-identical.
- [ ] Failing tests: two eyes with the same label and ids `'gpus-0'`, `'gpus-1'` share no `id="…"`; a label `<x>` renders `&lt;x&gt;`; golden unchanged.
- [ ] Implement; harness OK; commit `fix(ui): magicEye takes an id and escapes its label`.

### Task 2: The render tools and the layout (`tools/tube-renders/`)

**Files (create):** `tools/tube-renders/{layout.py,panel.py,parts.py,tubes.py,in12.py,pack.py,render.sh,README.md}`; `tests/test_tube_renders.py`.

**`layout.py`** (pure Python, no Blender): `HEIGHTS`, `VARIANTS = ['lab', 'sessions', 'gpus4', 'gpus8']`, `screen(variant, H)` → `{plates, paint, labels, slots}` in frame units, and `layout_hash()` (sha256 of the canonical JSON of every variant × height, first 12 hex). The v4 layout at H = 600, with these changes:
- **Header** (same for every variant and height): the 7 tab positions keep v4's geometry (3 large slots: lamp d=24 and a blank label plate; 4 small: lamp d=14), but no tab name is baked; slots are `{kind:'tab', size:'large'|'small', i}` (not keyed to a screen). Date window and clock slot as v4.
- **Growth with H** (spec "the extra height goes to the parts that grow"): `lab` keeps the condition and stations plates; the fault-register plate is `H − 320` tall and `faultlist.h = H − 368`. `sessions`: five row plates of `88 + (H − 600) / 5` (floored, the rest under the last row) and the slots move with them; the footer slot sits at `H − 24`. `gpus4`: module plates `H − 104` tall; `gpus8`: two rows of `(H − 112) / 2`. Module slots keep their v4 offsets scaled by `plate height / v4 plate height` (eye diameter and Nixie height unchanged).
- `python layout.py out.json` writes everything (used by `pack.py` and the tests).

**Blender scripts** (ported from v4; their only inputs are argv and the layout):
- `panel.py -- <out> <samples> [variant:H ...]` renders `panel-<variant>-<H>.png` at 2048 × 2H px, plates and fixed legends only (label plates blank).
- `parts.py` (jewels ×5 colours on/off, annunciator windows ×6 for 9-slice, magic-eye mount), `tubes.py` (IN-13 bargraph back/front), `in12.py` (IN-12 back/front: Rohan's chosen tube). The v4 IN-14 `nixie-*` part is dropped (replaced by IN-12).
- Fixed Cycles seed and samples (panel 256, parts 256, tubes 384), so a re-render reproduces the files.

**`render.sh`:** `TUBE_RENDER_HOST=user@host TUBE_BLENDER=/path/to/blender tools/tube-renders/render.sh` copies the scripts and fonts to a temp dir on the host, runs the four Blender scripts (panels for every variant × height), copies the PNGs back into `build/tube-renders/`, then runs `pack.py`.

**`pack.py`:** PNG → WebP (`quality=86, method=6`, alpha kept for parts); writes `chiketi/assets/tubes/*.webp`, `manifest.json` (`{hash, layout_hash, files: {name: {w, h, bytes}}}`; `hash` = sha256 of the layout hash and every file's bytes) and `chiketi/assets/ui/tubes_layout.js` (`const TUBES_LAYOUT = {…}` with labels and slots only, compact; `const TUBES_HASH`, `TUBES_FILES`, `TUBES_HEIGHTS`).

**Tests (`tests/test_tube_renders.py`, failing first):** every manifest file exists with its recorded size; the manifest `layout_hash` equals `layout.layout_hash()` and the hash inside `tubes_layout.js`; every variant × height is in the layout and has its panel in the manifest; total WebP bytes ≤ 4.5 MB; `layout.screen(v, H)` keeps every slot and plate inside `1024 × H`; slot positions at H = 600 equal v4's except the header tab slots.

- [ ] Steps: tests → layout.py → Blender scripts → render on the GPU host → pack → tests pass → commit `feat(tubes): render tools, layout, and the rendered parts` (assets included).

### Task 3: Serving the parts

**Files:** `chiketi/server.py`, `tests/test_server.py`, `scripts/gen_site_assets.py` (the site bundle maps the route to its copied files).

- `GET /assets/tubes/<name>.webp`: `name` must be a key of the manifest (loaded at startup, like the UI assets); otherwise 404. `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`. No path joins from the request (lookup by key only).
- `KIOSK_JS` gains `tubes_layout.js` before `kiosk_retro.js`; the manifest hash is part of `_DISPLAY_ASSETS`' build hash, so a deploy with new renders reloads open displays.
- [ ] Failing tests: a manifest name answers 200 `image/webp` with the cache header; `../x.webp`, `%2e%2e/…`, an unknown name, `x.png` → 404; changing the manifest hash changes `/api/display`'s `build`; `tubes_layout.js` is inlined.
- [ ] Implement; pytest; commit `feat(tubes): a bounded route for the rendered parts`.

### Task 4: The Tubes screens

**Files:** `chiketi/assets/ui/kiosk_retro.js`, `chiketi/assets/ui/screens.json` (`Vintage/Tubes` in the Kiosk allowlist), `tests/js/render_harness.js` (`KIOSK_WORDS['Vintage/Tubes']`, the image rule's manifest set from `TUBES_FILES`), `tests/test_devices.py` and `tests/test_server.py` (the theme list; with Tubes every real theme is a Kiosk theme, so the tests of the refusal and fallback paths, which stay for unknown and older themes, monkeypatch the Kiosk allowlist to leave Tubes out instead of relying on it), `scripts/devices_check.mjs` (step 13: a Self-mode theme now stays when the device switches to Kiosk; the fallback to TOS is covered by the Python tests), `docs/site/dashboard.js`.

**Shared parts** (ports of the v4 helpers, sizes in `kq`, URLs `tubUrl(name)` = `/assets/tubes/<name>.webp?v=<TUBES_HASH>`):
- `tubJewel(cx, cy, d, colour, on)`, `tubNixie(x, y, h, ch)` (IN-12 back, Antonio 100 numeral and glow placed from the measured metrics, front), `tubNeon(h)`, `tubNixieRow(x, y, h, str, align)`, `tubIn13(x, y, w, pct, colour, id)` (today's `tubeFilament` glow between back and front; ids from `id`), `tubEye(cx, cy, d, pct, id)` (`magicEye` with `opts.id`, empty label), `tubAnn(x, y, w, h, colour, inner, bw)`, `tubPaint(t, sz, col)` (live lettering; lit text carries `data-lit`), `tubPlate(label, text, colour, base)` (shrinks to fit on its plate; text escaped by the caller).
- `tubPanelH(h)`: the largest of `TUBES_HEIGHTS` ≤ h (576 below that). `tubFrame(variant, active, body)`: the panel image for `variant` at `tubPanelH(kioskH())`, steel under it, the tab lamps and live tab labels from `kioskMenu(active)` (built tabs in the large slots, planned in the small, each group in plan order; DOM order is the plan order; active lamp green, attention amber/red, others unlit; unused slots empty), the date window (warm white) and the Nixie clock HH:MM, `data-status`.

**Home Lab** (`tubLabV2`): condition lamps (NORMAL green, CAUTION amber, ALERT red; lit by `kioskLab().mode`, stale lights CAUTION, pending lights none) in a `<div data-cond>` whose lit name carries `data-lit`; HOSTS and FAULTS Nixies; stations: per slot an up lamp (blue up, red down, unlit unknown: Rohan's "blue when active, red when down") and a health lamp (green ok, amber warn, red crit or down, unlit unknown), the name on its plate (`data-host/up/health`); past 9 hosts, 8 and a `+N HOSTS` plate. Faults: `kioskIssueLayout(n, faultlist.h)` (≤ 4: large amber/red windows with host, title and SINCE in Nixies; else 2 × 8 compact windows; past 16, 15 and `+N MORE`), each `data-alert`; `n OPEN` above. Stale: lamps dimmed (opacity .55) and `STALE · CHECKED <age>` painted in amber by the register title. No issues: one dark window reading `NO OPEN FAULTS`.

**Sessions** (`tubSessionsV2`): five rows, each `data-session`: lamp, backlit window (amber waiting, warm white working, green shell, dark idle) with name, `PROJECT · STATE[ · message]` (the state word in a `<div data-state>` lit span), tokens / agents / running in Nixies with painted units (an unlit tube for none); empty rows a dark window. Footer `FEED LIVE · HOST` / `[+N MORE · ]N ACTIVE · n NEEDS INPUT`; offline: `SESSION FEED OFFLINE · LAST UPDATE HH:MM` (amber), windows dimmed; pending, unconfigured, empty: the message in the middle window.

**GPUs** (`tubGpusV2`): `gpus4` for ≤ 4 GPUs, else `gpus8`; each bay `data-gpu-row`: name plate `HOST · GPU i`, model (or `SEEN <age> AGO` for a cached row, dimmed), magic eye (load; `--` and a closed eye when missing), core temperature in Nixies with °C and `MEM n°` (`data-mem`), IN-13 VRAM (blue) and power (orange; green when idle) with their values, state lamp and state word in `<div data-state>`, `PROC n`. Unused bays: blank (the panel's plate). Past 8: `+N MORE` painted at the bottom right. Stale: `TELEMETRY STALE · LAST UPDATE <age>` painted beside the title. Empty states (`gpuEmptyNote`) in a warm window across the bays.

**Notice** (`tubNotice`): the `sessions` panel, every window dark, the middle one warm white reading `NO SCREENS TO SHOW`, the hint painted under it.

**Skin:** `kioskSkin('tube', '#0b0a09', PLEX)`.

**Harness words:** `lit: true`, `condWords: ['NORMAL', 'CAUTION', 'ALERT']`, `sessWord`: waiting `NEEDS INPUT`, busy `WORKING`, shell `RUNNING SHELL`, idle `IDLE` (the LOOKS lit-session check reads `W.sessWord` instead of VFD's fixed map, which moves into VFD's words); `legend`: every `GPU_WORDS` value, `gpuWord`/`gpuLit` = `GPU_WORDS`; `hostSlots: 9` (the 12-host check expects `min(12, 8)` stations plus a `+N HOSTS` plate when a look has fixed slots); `fixedSess: 5` (the tall-frame check expects exactly five rows); `status: {ok:'', warn:'', crit:''}`.

- [ ] Failing tests: allowlist + words + device list → harness `REGISTRY` fails; an `<img>` with a non-manifest URL or an extra attribute fails the image rule; `tubPanelH` for 576–770 and 246/1200 (→ 600); two GPU eyes have distinct ids.
- [ ] Implement; harness OK (golden only added keys); pytest; check_js; commit `feat(kiosk): Tubes Home Lab, Sessions and GPUs`.

### Task 5: Preload and decode

**Files:** `chiketi/assets/ui/display_app.js`, `scripts/devices_check.mjs`.

- When the theme is `Vintage/Tubes`, the display keeps a set of `Image` objects for the plan's screens at `tubPanelH(kioskH())` (their panel variants; `gpus4` and `gpus8` both when the GPU count is within one of the boundary) plus the shared parts, calls `decode()` on each, and replaces the set when the height, the plan, or the variant choice changes (dropping references to the old ones). Other themes: no set.
- [ ] devices_check: with Tubes chosen, after a redraw every `<img>` on screen is `complete` and `naturalWidth > 0` within 3 s.
- [ ] commit `feat(display): preload the Tubes parts a display needs`.

### Task 6: Browser checks and parity

- [ ] fit_check full matrix for `Vintage/Tubes` (its shapes include 800×480) and the 1- and 7-tab runs; preview_check (17 themes); devices_check.
- [ ] Parity: the private tool's `tub` look (v4 prototype on the pinned engine vs the build), the 5 frames; every region over 0.5 % fixed or listed (expected: the IN-12 digits if the v4 page predates them, the live tab labels, the blue up lamps).

### Task 7: Review, the Go, deploy

- [ ] Independent review of the branch (Codex is out of quota until 2026-10-30: a fresh Claude reviewer on the most capable model, same adversarial brief) until approved; each finding fixed with a failing test first.
- [ ] Merge, push, CI, `chiketi-site deploy server --dry-run`, deploy (Rohan authorised the phase on 2026-10-25).
- [ ] On the Go, over CDP: warm redraw (20 per screen, busy fixtures) and cold readiness with the WebP parts from the chiketi server; memory over 60 minutes of rotation if time allows. Record the numbers; if over budget, report (keeping the static layers between redraws is a separate, approved change).
- [ ] Go screenshots of the three Tubes screens; parity page updated; Rohan's per-screen feedback round follows.

---

## Revisions after the plan review (independent reviewer; Codex out of quota)

These override the tasks above where they differ.

1. **Tabs follow the plan on screen, not only in the DOM.** Nothing about the tabs is baked. The header has one `tabrow` slot (x 222–676); `tubFrame` lays the plan's tabs out left to right in plan order, a built screen 84 units wide (lamp d=24 over the new `tabplate` part, 76 × 22, with its live label), a planned one 46 (lamp d=14 over painted lettering, wrapped on a space and shrunk to fit). 3 × 84 + 4 × 46 = 436 ≤ 454. Harness: the `data-tab` left offsets rise in DOM order; a layout test: the Kiosk screen list fits the row.
2. **GPU footer.** `gpus4` modules are `H − 128` tall, `gpus8` rows `(H − 136) / 2`; a `gfoot` slot at `H − 24` carries `gpuFooterText` (counts, power or partial power, nodetail/incomplete notes), the stale marker and `+N MORE`. A listed difference from v4 (whose modules ran to the bottom).
3. **Host checks.** The three LOOKS host checks (per-fixture cap, HL_LONG12, the 12-host loop) use `W.hostSlots`: a look with 9 slots shows `min(n, 9)` when n ≤ 9, else 8 stations and a `+N HOSTS` plate whose count is checked exactly. Past 9, the 8 shown are the worst first (down, crit, warn, unknown, ok; ties in the server's order) and the `+N` plate takes the worst hidden health's colour.
4. **Tubes words** (all in `data-lit` text): lab `FULL`/`KIOSK_CALM` `NORMAL`, `HL_YELLOW` `CAUTION`, `HL_RED`/`HL_BUSY` `ALERT` (in `data-cond`), `HL_STALE` `STALE · CHECKED`, `HL_PENDING` `ACQUIRING TELEMETRY`, `HL_UNCONFIGURED` `HOME LAB NOT CONFIGURED`; sessions and GPUs keep the TOS words (lit); `memHas` matches `MEM n°`; the lit-session check uses `W.sessWord`. The harness's own `KIOSK_JS` list gains `tubes_layout.js`; `__HARNESS.tubesFiles()` exposes `TUBES_FILES`, and `imgReason` requires the name to be one of them, for `<img src>` and for every CSS `url(` (the `border-image` windows).
5. **`magicEye` with no reading:** `opts.text` overrides the printed percentage; the Tubes GPU bay passes `--` and a closed eye (pct 0) when load is missing. Absent `opts.text`, output is unchanged (golden). (The label was already escaped by Task 1.)
6. **Fault capacity grows with the frame** (`kioskIssueLayout` adds rows past 16 alerts when there is room), as on the other looks; the Capacities line reads "4 large, else 2 columns of 8 (more rows in a tall frame), then `+N MORE`", and the checks run at 600 and 683.
7. **Images:** parts carry `alt=""` and an explicit `kq` width and height; only the opaque panel needs steel behind it, and the frame already has it (no dark boxes behind the alpha parts).
8. **Caching:** `immutable, max-age=31536000` only when `?v=` equals the current manifest hash, else `no-cache`; a missing manifest makes the route 404 (no crash at startup). A test recomputes the manifest hash from the layout hash and the file bytes.
9. **Renders** are not bit-reproducible on a GPU: no claim; the manifest records the Blender version and samples (`rendered_with`). `render.sh` makes the weight-100 Antonio instance for the IN-12 cathodes at render time (never shipped).
10. **Refused-theme coverage:** `tests/test_screens.py`, `tests/test_server_devices.py`, `tests/test_state.py`, `tests/test_devices.py`, `tests/test_server.py` monkeypatch the Kiosk allowlist to leave Tubes out where they test the "valid Self theme, not a Kiosk theme" path; `devices_check` step 13 checks that a Self theme stays on the switch to Kiosk.
11. **Notice variant:** a fifth panel variant `notice` (title STANDBY, one body plate, `nwin` and `nhint` slots), so the notice shows no session legends.
12. **Session tokens:** Nixie digits with an INS-1 decimal-point lamp where the value has one, and the unit from `/[KMB]$/`.
13. **Site:** it draws only Self screens: no WebPs in `docs/`, only the regenerated bundle.
14. **Tests:** `tubPanelH(kioskH())` after `setFrameH(246)` and `(1200)` gives 600; slot extents per kind (circles with the 1.1 bezel, right-aligned Nixie rows, the five-glyph clock); "v4 at 600" checks against committed v4 coordinates for `lab` and `sessions` (the GPU modules change by design, item 2).
15. **Performance:** cold readiness with the cache cleared and the preload off; the 60-minute memory check is required. Preloading both GPU variants near the 4/5 boundary means up to 4 panels (about 60 MB decoded, within the 120 MB budget; noted as a change to "at most 3").
16. **Switches:** the harness switch sequence includes the Self Tubes screens (`tubeScreen1`, `tubeGpuScreen`). Plate lettering sizes from the raw code-point length, then escapes; minimum 9 units, then an ellipsis.

## Results on the Go (deployed build, 2026-10-25)

Measured in the Go's own Chromium over CDP, the WebP parts served by the chiketi server:

| Screen (fixture) | Cold readiness (cache off, no preload) | Warm redraw median | Warm p95 |
|---|---|---|---|
| Home Lab (HL_BUSY) | 308–383 ms | 34 ms | 50 ms |
| Sessions (SESS_BUSY) | 330–381 ms | 35 ms | 99 ms |
| GPUs, 8 cards (GPU_HOUSE_BUSY) | 344–683 ms | 117 ms | 184 ms |
| GPUs, 9 states (GPU_HOUSE) | 464–620 ms | 117 ms | 150 ms |

Budgets (spec): cold ≤ 1.5 s, warm median ≤ 150 ms, p95 ≤ 300 ms: all met.
