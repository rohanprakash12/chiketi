# Kiosk Looks, Phase 2 (Scanlines, VFD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Kiosk screens (Home Lab, Sessions, GPUs) in Vintage/Scanlines and Vintage/VFD, each looking the way its agreed v4 mockup does, on the phase 1 contracts (up/health, attention, plan-driven menus, landscape-only geometry, golden hashes).

**Architecture:**
- One new family file, `chiketi/assets/ui/kiosk_retro.js` (Scanlines and VFD now; Tubes joins it in phase 3), appended after `kiosk_terminal.js` through `server.py`'s `KIOSK_JS` (so the display, the control panel, the harness and the site bundle all see it). It ends with `Object.assign(KIOSK_RENDERERS, RETRO_RENDERERS)`.
- Two small shared additions in `kiosk_looks.js`: `kioskSkinFrom` (a frozen, cached look variant of an existing skin) and `kioskIssueLayout` (the scaling alert list both looks use).
- One additive hook in `screen_functions.js`: `gpuStateColor` asks the skin first (`S.gpuState`), so Scanlines' GPU rows take its colours without re-assigning a global. No skin has the key today, so TOS, Claude and Self output stays byte-identical (golden hashes).
- Each screen is a port of its v4 prototype function, px turned into `kq()`, 600 turned into `kioskH()`, the mock adapters replaced by `kioskLab/kioskSess/kioskGpus/kioskMenu/kioskWorst`.

**Tech Stack:** browser JS evaluated by the Node harness; Playwright (fit_check, preview_check, devices_check, parity); pytest.

**Spec:** `specs/2026-10-24-kiosk-looks-design.md` (sections "Scanlines", "VFD", the integration contracts, Geometry, Visual QA).

**Reference (private, not copied into this repo):** `../chiketi-private/design/kiosk-looks/v4/proto/proto.js`: `SCAN_V3`, `SCAN_K`, `scanLabV2`, `scanSessionsV2` (+ `tosSessFoot`), `scanGpusV2` (+ `protoGpusScreen`), `VFD_K`, `VF`, `vt`, `vghost`, `vleg`, `vbar`, `vfdFrame`, `vfdLabV2`, `vfdSessionsV2`, `vfdGpusV2`, `pIssueLayout`. Every visual value not written here comes from there, unchanged apart from the unit.

## Global Constraints

- Public repo: neutral names only (`gpubox`, `devbox`, `192.0.2.x`).
- Harness rules: no layout `px` over 2; every data string through `esc()`; FULL defines every metric read; no `undefined`/`NaN`/`[object Object]`.
- Upper-casing happens on the raw string, before `esc()` (`esc(String(x).toUpperCase())`), never on escaped text.
- Units: a prototype `n`px is `kq(n)`; a prototype `600` is `kioskH()`. No new layout reads `frameH()`/`fluidH()` directly. The Scanlines raster pitch is in frame units too (`kq`), as the spec states it ("a 3-unit pitch").
- New renderers call `bsFrame(body, 'landscape', look)` and are registered with `fluid: 'landscape'` and a `notice`.
- Order: alerts in the server's `issues` order (no re-sort), sessions in `sessData()` order, GPUs in `gpuHouseData()` order.
- Capacities at 576 units: Home Lab 8 alerts, Sessions 5, GPUs 8, then `+N MORE` counting the hidden items; every host up to 12.
- Clock `HH:MM` plus day and date on every screen.
- Every frame carries `data-status="<kioskWorst()>"` (the harness reads it; it draws nothing).
- Golden: existing keys must not change; `GOLDEN=update` may only add keys.
- Don't run `ruff format`. Restart the dev server after UI edits; throwaway `XDG_CONFIG_HOME`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01BmBXX8FiZQeTmh7ahaTUZ1`.

## Review Focus

1. Switching Scanlines → TOS → Scanlines (and VFD → TNG → VFD) gives fresh output each time and leaves TOS byte-identical: the variant skins are frozen copies and `BS_SKIN_SCAN`/`BS_SKIN_VFD` are never written. Harness switch and skin-snapshot checks.
2. VFD's ghost legends spell every state word whether lit or not, so a word check alone proves nothing: lit text carries `data-lit`, and VFD's harness words are matched only inside lit spans.
3. Twelve hosts with long names on Scanlines: chips pack into at most two rows (compact chips if needed) and the alert list moves down with them, never under them. Harness 12-host case, fit_check with long-name fixtures.
4. Eight GPUs at 576 units with stale data (banner) on Scanlines: rows tighten until 8 show, `+N MORE` exact. Harness GPU cases.
5. Hostile strings (host, title, detail, session name/project/message, GPU name) never become markup in either look, including the upper-cased VFD text. HOSTILE sweep over every Kiosk theme.

---

### Task 1: Shared pieces (`kioskSkinFrom`, `kioskIssueLayout`, the `gpuStateColor` skin hook)

**Files:**
- Modify: `chiketi/assets/ui/kiosk_looks.js`, `chiketi/assets/ui/screen_functions.js` (`gpuStateColor`)
- Test: `tests/js/render_harness.js` (KIOSK CORE block)

**Interfaces:**
- Produces:
  - `kioskSkinFrom(id, base, extra)`: returns (and `bsSkin`s) `Object.freeze(Object.assign({}, base, extra))`, cached by `id`; the same object on every call with that id.
  - `kioskIssueLayout(n, h)`: `{ cols, rows, rowH, big, shown, more }`. `n <= 4`: one column, `big`, `rowH = min(76, floor(h / max(1, n)))`, all shown. Otherwise `rows = min(8, ceil(min(n, 16) / 2))`, two columns, `rowH = floor(h / rows)`; with `n > rows*2` the last cell is the `+N MORE` line: `shown = rows*2 - 1`, `more = n - shown`.
  - `gpuStateColor(st)`: `if (typeof S.gpuState === 'function') return S.gpuState(st);` before today's mapping.

- [ ] **Step 1: failing tests** in KIOSK CORE: `kioskSkinFrom('t', BS_SKIN_SCAN, {kHour:'#123'})` is frozen, is the same object on a second call, has `kHour '#123'` and `key 'scan'`, and `BS_SKIN_SCAN.kHour` stays `undefined`; `kioskIssueLayout(15, 284)` → `{cols:2, rows:8, shown:15, more:0}`; `kioskIssueLayout(20, 284)` → `shown 15, more 5`; `(3, 300)` → `big, rowH 76`; a skin with `gpuState: () => '#abc'` makes `gpuStateColor('busy') === '#abc'`.
- [ ] **Step 2:** `node tests/js/render_harness.js` → FAIL (functions missing).
- [ ] **Step 3:** implement.
- [ ] **Step 4:** harness → `renderer harness OK` (golden unchanged: no existing skin has `gpuState`).
- [ ] **Step 5:** commit `feat(kiosk): look skins from any base, the scaling alert list, a skin hook for GPU state colours`.

### Task 2: Scanlines

**Files:**
- Create: `chiketi/assets/ui/kiosk_retro.js`
- Modify: `chiketi/server.py` (`KIOSK_JS` gains `"kiosk_retro.js"`), `chiketi/assets/ui/screens.json` (`modes.kiosk.themes` gains `Vintage/Scanlines`), `tests/js/render_harness.js` (`KIOSK_WORDS['Vintage/Scanlines']`), `tests/test_devices.py` (the parametrised theme list), `docs/site/dashboard.js` (regenerated)
- Test: harness LOOKS/PLAN/HOSTILE sweeps (discovered from `SCREEN_SPEC`), `tests/test_server.py` (inlined files)

**Interfaces:**
- Consumes: Task 1; phase 1 `kioskLab/kioskSess/kioskGpus/kioskWorst/kioskFit/kioskClock/kq/kioskH`; today's `bsHeader`, `bsSessionHeadings`, `bsSessionRow`, `bsGpuHeadings`, `bsGpuRow`, `GPU_COLS`, `gpuStatusColor`, `sessStatusColor`, `gpuFooterText`, `gpuEmptyNote`.
- Produces: `scanHomelab(c)`, `scanSessions(c)`, `scanGpus(c)`, `scanNotice(c)`; `RETRO_RENDERERS['Vintage/Scanlines'] = { lab, sessions, gpus, notice, fluid: 'landscape' }`.

**The skins** (frozen, via `kioskSkinFrom`):
- `SCAN_K = { kHour: _SC.cyan||'#00FFCC', kSec: _SC.amber||'#FFAA00', kDay: _SC.amber||'#FFAA00', kDate: _SC.cyan||'#00FFCC' }`.
- `scanSkin(pitch, peak)` = `BS_SKIN_SCAN` + `SCAN_K` + `{ overlay: CRT_OVERLAY` with its `_crtScanlines(4, 0.30)` layer replaced by `kioskScanlines(pitch, peak)` (the same ramp as `_crtScanlines`, stops in `kq` units), `contentFilter: 'brightness(1.18) saturate(1.06)'`, `frameCss: 'border-radius:' + kq(22) + ';box-shadow:inset 0 0 ' + kq(90) + ' ' + kq(40) + ' rgba(0,0,0,0.5)'`, `glowFn`: today's at `px * 1.35` with the `66,` taps raised to `a0,` and `2b` to `48` (as `SCAN_V3`), `gpuState`: critical → `crit`, hot/throttling → `warn`, busy → `a4`, idle → `a2`, everything else → `soft` }`.
- Home Lab and Sessions use `scanSkin(3, 0.2)`; GPUs `scanSkin(2, 0.12)` (spec: finest, faintest lines on the smallest type).

**Home Lab** (`scanLabV2`):
- Frame: the 6-unit top bar in the condition colour (ok → `a1`, warn or stale → `warn`, crit → `crit`), `bsHeader('lab')` (today's TOS-style header and plan tabs), the condition word (`ALL SYSTEMS NOMINAL` / `YELLOW ALERT` / `RED ALERT`, 54 units, letter-spacing 12), host chips, the alert list, the footer (`CHECKED <age> AGO · N HOSTS` left; `n HEALTHY · n WARN · n CRIT` right).
- Chips: `data-host/data-up/data-health`. The dot is `a2` (blue) when up, `crit` when down, `track` and unlit when unknown; the border and text take the health colour (ok quiet as in the mockup, warn `warn`, crit or down `crit`, unknown `soft`); `n` issues after the name. Width is estimated in code (`scanChipW(h, size)`: padding, border, dot, gap, characters × (0.54 × size + letter-spacing), count) and chips are packed greedily into rows of 968 units with gap 8. More than 2 rows → compact chips (font 16, height 30, padding 10) and repack; still more than 2 rows → as many as fit in 2 rows and a `+N HOSTS` chip.
- Alert list top = 262 + 46 × (chipRows − 1); height `AH = kioskH() − top − 40`; `kioskIssueLayout(n, AH)`; the big and compact rows as the mockup, each with `data-alert="<index>"`; the `+N MORE` cell.
- States: pending → the condition area reads `ACQUIRING TELEMETRY` (dim, no chips, no list); unconfigured → `HOME LAB NOT CONFIGURED`; stale → condition colour `warn`, the word `TELEMETRY STALE`, chips and list kept at opacity 0.55; no issues → the list area reads `NO OPEN ALERTS` (dim).

**Sessions** (`scanSessionsV2`): its own layout on today's rows, so capacity follows the spec, not today's TOS rule.
- The 6-unit status bar in `sessStatusColor`, `bsHeader('sessions')`, `bsSessionHeadings()`, rows by `bsSessionRow(s, rowH)` each wrapped in `<div data-session="<index>">`, the footer: `FEED LIVE · <host>` left, `N ACTIVE · n NEEDS INPUT` right (amber when waiting); offline keeps today's `SESSION FEED OFFLINE · LAST UPDATE HH:MM` text.
- Body `TOP 118`, `FOOT 40`, rows 64 (gap 8) under 34-unit headings; `capAll = floor((rowsH + 8) / 72)`, `capMore = floor((rowsH − 27 + 8) / 72)`; `kioskFit(n, capAll, capMore)`; a short list grows its rows as today (up to 80). At 576: `capMore = 5`.
- States as today: unconfigured, pending, empty, offline (rows at 0.45).

**GPUs** (`scanGpusV2` / `protoGpusScreen`):
- The 6-unit bar in `gpuStatusColor`, `bsHeader('gpus')`, the stale banner (34), `bsGpuHeadings(GPU_COLS, 34, 11.5)`, rows by `bsGpuRow` (they carry `data-gpu-row`), the footer `gpuFooterText`.
- Row height: 64; if more rows than fit, 48 (the mockup's step); if still fewer than `min(n, 8)` fit, `rowH = floor((rowsH − 27 + 6) / 8) − 6` so 8 always show; `kioskFit` with the `+N MORE` line reserved; `k = rowH / 64`.
- Empty states from `gpuEmptyNote`.

**Notice:** `scanNotice`: the Scanlines frame (`scanSkin(3, 0.2)`) with `NO SCREENS TO SHOW` (54 units, `soft`) and `CHOOSE SCREENS IN THE CONTROL PANEL` under it.

**Harness words:** `LOOK_WORDS({}, { status: { ok: '', warn: '', crit: '' } })` (BS words; the frame has no worst-colour part, as Terminal), stale word `TELEMETRY STALE`.

- [ ] **Step 1: failing tests.** Add `Vintage/Scanlines` to `screens.json` and its `KIOSK_WORDS`; add it to `tests/test_devices.py`'s list; add to `tests/test_server.py` the expectation that `kiosk_retro.js` is inlined and in the build hash.
- [ ] **Step 2:** harness → FAIL (`REGISTRY`: theme without renderers); pytest server/devices → FAIL.
- [ ] **Step 3:** implement `kiosk_retro.js`, `KIOSK_JS`, regenerate `docs/site/dashboard.js` (`.venv/bin/python scripts/gen_site_assets.py`).
- [ ] **Step 4:** harness → OK (LOOKS, PLAN, HOSTILE, switch, skins-never-written all pass for Scanlines); `GOLDEN=update` only if it reports added keys, then a plain run → OK with no changed keys; pytest → PASS; `./scripts/check_js.sh` → OK.
- [ ] **Step 5:** commit `feat(kiosk): Scanlines Home Lab, Sessions and GPUs`.

### Task 3: VFD

**Files:**
- Modify: `chiketi/assets/ui/kiosk_retro.js`, `screens.json` (`Vintage/VFD`), `tests/js/render_harness.js` (`KIOSK_WORDS['Vintage/VFD']`, the `lit` matcher), `tests/test_devices.py`, `docs/site/dashboard.js`

**Interfaces:**
- Produces: `vfdHomelab`, `vfdSessions`, `vfdGpus`, `vfdNotice`; `RETRO_RENDERERS['Vintage/VFD']`.

**Pieces:** `VF` colours from `_VF` (as the mockup); `vt(t, sz, c, ls)` lit text, a `<span data-lit …>` with the two-stage glow; `vghost(t, sz, ls)` unlit (`#13241e`); `vleg(words, on, c, sz)`; `vbar` = `BS_SKIN_VFD.barFn`. All sizes in `kq`. The skin: `kioskSkinFrom('vfd-k', BS_SKIN_VFD, VFD_K)` with `VFD_K = { kHour: green, kSec: amber, kDay: amber, kDate: green }` (filament overlay and frame kept).

**Frame** (`vfdFrame`): menu from `kioskMenu(active)` in plan order: active → green with `▶ `, live with attention → amber (red for crit), live otherwise → blue, planned → ghost at 11 units; each live item carries `kioskTabAttrs`. Clock `HH:MM` (62) at the top right with the day (amber) and `D MON YYYY` (blue) under it; the gradient rule at 96; body from 108 to 12 from the bottom. `data-status` on the frame.

**Home Lab** (`vfdLabV2`): the four big counts (HOSTS, HEALTHY, WARN, ALERT; unlit ghosts when zero), the NORMAL / CAUTION / ALERT legend with one lit, `CHECKED <age> AGO`; hosts in a 3-column grid (30-unit rows, `data-host/up/health`): `▲` blue up, `▼` red down, `△` ghost unknown; the name in the health colour; `OK` / `WARN n` / `ALERT n` / `DOWN` / `--`. At most 4 grid rows: more than 12 hosts → 11 and `+N HOSTS`. The alert list below, `AH = kioskH() − 108 − 12 − (84 + 10 + 32 × gridRows + 17)`, `kioskIssueLayout`, rows with `data-alert`. States: pending, unconfigured (centred lit note), stale (legend lights `CAUTION`, the checked line reads `STALE · CHECKED <age> AGO` in amber, hosts and list at 0.55), no issues → `NO OPEN ALERTS` ghost-lit.

**Sessions** (`vfdSessionsV2`): rows `data-session`, name (25, amber waiting / dim idle / green), project (14), message for a waiting session (13, amber), the INPUT / WORK / SHELL / IDLE legend, tokens (`kioskTok`), agents (`--` for none), running time (first word of `sessAge`). Row height `min(88 with message / 76 without, floor((bodyH − 30) / 5))`; capacity `capAll = floor((bodyH − 30) / 76)` (never under 5 at 576 because rows shrink), `capMore` reserves the footer's `+N MORE ·` prefix (no extra line); footer `[+N MORE · ]FEED LIVE · HOST` and `N ACTIVE · n NEEDS INPUT`. States: offline (rows 0.45, footer `SESSION FEED OFFLINE · LAST UPDATE HH:MM` amber), pending, unconfigured, empty.

**GPUs** (`vfdGpusV2`): `rowH = max(50, min(104, floor((kioskH() − 150 − more ? 24 : 0) / shown)))`, `big = rowH >= 80`; capacity `capAll = floor((kioskH() − 150) / 50)`, `capMore = floor((kioskH() − 174) / 50)`; rows `data-gpu-row="<host>|<index>"`: `HOST i` (+ short model, 13), the state legend (big rows: BUSY / IDLE / THROT / HOT lit per state, critical lights HOT in red; states outside the four light their own `GPU_LABEL` word instead), LOAD and VRAM bars (`--` text and an empty bar when missing), temperature with `MEM n°` under it (`data-mem`), power `n W` and `OF n W` when the limit is known. A cached row (not fresh) dims to 0.6 and its state line adds `SEEN <age> AGO`. The footer `N GPUS · n BUSY · <gpuPowerText> · CHECKED <age>`, plus `NOT REACHED: …` when inventory is incomplete. Stale → a `TELEMETRY STALE · LAST UPDATE <age> AGO` line (amber) above the rows, counted in the height. Empty states from `gpuEmptyNote`, as a centred lit note.

**Notice:** `vfdNotice`: the frame with `NO SCREENS TO SHOW` lit and the hint under it.

**Harness words:** `lit: true` (the harness's `has()` matches a word only as `data-lit[^>]*>…WORD`), BS words with `HL_YELLOW: 'CAUTION'`, `HL_RED: 'ALERT'`, `FULL: 'CAUTION'`/`KIOSK_CALM: 'NORMAL'` per fixture, `gpuWord`: busy `BUSY`, idle `IDLE`, throttling `THROT`, hot and critical `HOT`, others `GPU_WORDS`; `status: { ok: '', warn: '', crit: '' }`; `memHas` on `data-mem`.

- [ ] **Step 1: failing tests:** `screens.json`, words, test_devices list.
- [ ] **Step 2:** harness → FAIL (`REGISTRY`).
- [ ] **Step 3:** implement; regenerate the site bundle.
- [ ] **Step 4:** harness OK (golden: only added keys), pytest PASS, check_js OK.
- [ ] **Step 5:** commit `feat(kiosk): VFD Home Lab, Sessions and GPUs`.

### Task 4: Browser checks, parity, review

- [ ] `fit_check` full matrix for `THEMES=Vintage/Scanlines,Vintage/VFD` (shapes and cases as phase 1) → 0 fail; 1-tab and 7-tab runs → ok.
- [ ] `preview_check` → every case ok (16 themes).
- [ ] `devices_check` → 19 steps ok (step 19 discovers the looks from `screens.json`).
- [ ] Parity: `parity.mjs out crt,vfd` (private tool, pinned engine on 127.0.0.2) → every frame's differing share and regions; fix or list each region over 0.5 %; rebuild the parity page with phases 1 and 2.
- [ ] Codex adversarial review of the branch until APPROVED; each finding fixed with a test that failed first.
- [ ] Merge, push, CI green, `chiketi-site deploy server --dry-run`, deploy, Go screenshots for both looks added to the parity page.
