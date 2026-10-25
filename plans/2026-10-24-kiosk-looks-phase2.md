# Kiosk Looks, Phase 2 (Scanlines, VFD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Kiosk screens (Home Lab, Sessions, GPUs) in Vintage/Scanlines and Vintage/VFD, each looking the way its agreed v4 mockup does, on the phase 1 contracts (up/health, attention, plan-driven menus, landscape-only geometry, golden hashes).

**Architecture:**
- One new family file, `chiketi/assets/ui/kiosk_retro.js` (Scanlines and VFD now; Tubes joins it in phase 3), appended after `kiosk_terminal.js` in `server.py`'s `KIOSK_JS` (display, control panel, build hash; `scripts/gen_site_assets.py` imports that tuple) **and** in the harness's own `KIOSK_JS` list (`tests/js/render_harness.js:93`), which is separate. It ends with `Object.assign(KIOSK_RENDERERS, RETRO_RENDERERS)`.
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
  - `kioskIssueLayout(n, h)`: `{ cols, rows, rowH, big, shown, more }`. `n <= 4`: one column, `big`, `rowH = min(76, floor(h / max(1, n)))`, all shown. Otherwise `rows = min(8, ceil(min(n, 16) / 2))` (the design arrangement); when `n > 16` a taller list adds rows while each stays at least 30 units: `rows = max(8, min(ceil(n / 2), floor(h / 30)))`; two columns, `rowH = floor(h / rows)`; with `n > rows*2` the last cell is the `+N MORE` line: `shown = rows*2 - 1`, `more = n - shown`.
  - `gpuStateColor(st)`: `if (typeof S.gpuState === 'function') return S.gpuState(st);` before today's mapping.
  - Harness: `SKIN_SNAP` also records the identity of every function-valued property of every shared skin (`BS_SKIN_*`), and the skins-never-written check compares those identities too.

- [ ] **Step 1: failing tests** in KIOSK CORE: `kioskSkinFrom('t', BS_SKIN_SCAN, {kHour:'#123'})` is frozen, is the same object on a second call, has `kHour '#123'` and `key 'scan'`, and `BS_SKIN_SCAN.kHour` stays `undefined`; `kioskIssueLayout(15, 284)` → `{cols:2, rows:8, shown:15, more:0}`; `kioskIssueLayout(20, 284)` → `rows 9, shown 17, more 3`; `kioskIssueLayout(40, 480)` → `rows 16, shown 31, more 9` (taller shows more); `(3, 300)` → `big, rowH 76`; a skin with `gpuState: () => '#abc'` makes `gpuStateColor('busy') === '#abc'`.
- [ ] **Step 2:** `node tests/js/render_harness.js` → FAIL (functions missing).
- [ ] **Step 3:** implement.
- [ ] **Step 4:** harness → `renderer harness OK` (golden unchanged: no existing skin has `gpuState`).
- [ ] **Step 5:** commit `feat(kiosk): look skins from any base, the scaling alert list, a skin hook for GPU state colours`.

### Task 2: Scanlines

**Files:**
- Create: `chiketi/assets/ui/kiosk_retro.js`
- Modify: `chiketi/server.py` (`KIOSK_JS` gains `"kiosk_retro.js"`), `tests/js/render_harness.js` (its own `KIOSK_JS` list gains `'kiosk_retro.js'`), `tests/js/fixtures.js` (two busy fixtures, below), `scripts/fit_check.mjs` (their cases), `chiketi/assets/ui/screens.json` (`modes.kiosk.themes` gains `Vintage/Scanlines`), `tests/js/render_harness.js` (`KIOSK_WORDS['Vintage/Scanlines']`), `tests/test_devices.py` (the parametrised theme list), `docs/site/dashboard.js` (regenerated)
- Test: harness LOOKS/PLAN/HOSTILE sweeps (discovered from `SCREEN_SPEC`), `tests/test_server.py` (inlined files)

**Interfaces:**
- Consumes: Task 1; phase 1 `kioskLab/kioskSess/kioskGpus/kioskWorst/kioskFit/kioskClock/kq/kioskH`; today's `bsHeader`, `bsSessionHeadings`, `bsSessionRow`, `bsGpuHeadings`, `bsGpuRow`, `GPU_COLS`, `gpuStatusColor`, `sessStatusColor`, `gpuFooterText`, `gpuEmptyNote`.
- Produces: `scanHomelab(c)`, `scanSessions(c)`, `scanGpus(c)`, `scanNotice(c)`; `RETRO_RENDERERS['Vintage/Scanlines'] = { lab, sessions, gpus, notice, fluid: 'landscape' }`.

**The skins** (frozen, via `kioskSkinFrom`):
- `SCAN_K = { kHour: _SC.cyan||'#00FFCC', kSec: _SC.amber||'#FFAA00', kDay: _SC.amber||'#FFAA00', kDate: _SC.cyan||'#00FFCC' }`.
- `scanSkin(pitch, peak)` = `kioskSkinFrom('scan-' + pitch + '-' + peak, …)`: `BS_SKIN_SCAN` + `SCAN_K` + `{ overlay: CRT_OVERLAY` with its `_crtScanlines(4, 0.30)` layer replaced by `kioskScanlines(pitch, peak)` (the same ramp as `_crtScanlines`, stops in `kq` units), `contentFilter: 'brightness(1.18) saturate(1.06)'`, `frameCss: 'border-radius:' + kq(22) + ';box-shadow:inset 0 0 ' + kq(90) + ' ' + kq(40) + ' rgba(0,0,0,0.5)'`, `glowFn`: today's at `px * 1.35` with the `66,` taps raised to `a0,` and `2b` to `48` (as `SCAN_V3`), `gpuState`: critical → `crit`, hot/throttling → `warn`, busy → `a4`, idle → `a2`, everything else → `soft` }`.
- Home Lab and Sessions use `scanSkin(3, 0.2)`; GPUs `scanSkin(2, 0.12)` (spec: finest, faintest lines on the smallest type).

**Home Lab** (`scanLabV2`):
- Frame: the 6-unit top bar in the condition colour (ok → `a1`, warn or stale → `warn`, crit → `crit`), `bsHeader('lab')` (today's TOS-style header and plan tabs), the condition word (`ALL SYSTEMS NOMINAL` / `YELLOW ALERT` / `RED ALERT`, 54 units, letter-spacing 12), host chips, the alert list, the footer (`CHECKED <age> AGO · N HOSTS` left; `n HEALTHY · n WARN · n CRIT` right).
- Chips: `data-host/data-up/data-health`. The dot is `a2` (blue) when up, `crit` when down, `track` and unlit when unknown; the border and text take the health colour (ok quiet as in the mockup, warn `warn`, crit or down `crit`, unknown `soft`); `n` issues after the name. Width is estimated in code (`scanChipW(h)`: padding, border, dot, gap, characters × (0.54 × 19 + 3), count) and chips are packed greedily, centred, into rows of 968 units with gap 8, as the mockup. If that needs more than 2 rows, the chips switch to a fixed grid that is guaranteed to fit: 6 columns × 2 rows of equal width (`(968 − 5×8) / 6`), height 34, font 16, the name ellipsized, dot and count always visible. Up to 12 hosts all show; more than 12 → 11 chips and a `+N HOSTS` cell.
- Alert list top = 262 + 46 × (chipRows − 1); height `AH = kioskH() − top − 40`; `kioskIssueLayout(n, AH)`; the big and compact rows as the mockup, each with `data-alert="<index>"`; the `+N MORE` cell.
- States: pending → the condition word is `ACQUIRING TELEMETRY` (dim) and the configured hosts' chips stay, every dot unlit and every health `unknown` (spec: lamps unknown while pending); no list; with no hosts, the word alone. Unconfigured → `HOME LAB NOT CONFIGURED`; stale → condition colour `warn`, the word `TELEMETRY STALE`, chips and list kept at opacity 0.55; no issues → the list area reads `NO OPEN ALERTS` (dim).

**Sessions** (`scanSessionsV2`): its own layout on today's rows, so capacity follows the spec, not today's TOS rule.
- The 6-unit status bar in `sessStatusColor`, `bsHeader('sessions')`, `bsSessionHeadings()`, rows by `bsSessionRow(s, rowH)` each wrapped in `<div data-session="<index>">`, the footer: `FEED LIVE · <host>` left, `N ACTIVE · n NEEDS INPUT` right (amber when waiting); offline keeps today's `SESSION FEED OFFLINE · LAST UPDATE HH:MM` text.
- Body `TOP 118`, `FOOT 40`, rows 64 (gap 8) under 34-unit headings; `capAll = floor((rowsH + 8) / 72)`, `capMore = floor((rowsH − 27 + 8) / 72)`; `kioskFit(n, capAll, capMore)`; a short list grows its rows as today (up to 80). At 576: `capMore = 5`.
- States as today: unconfigured, pending, empty, offline (rows at 0.45).

**GPUs** (`scanGpusV2` / `protoGpusScreen`):
- The 6-unit bar in `gpuStatusColor`, `bsHeader('gpus')`, the stale banner (34), `bsGpuHeadings(GPU_COLS, 34, 11.5)`, rows by `bsGpuRow` (they carry `data-gpu-row`), the footer `gpuFooterText`.
- Row height: 64; if more rows than fit, 48 (the mockup's step); if still fewer than `min(n, 8)` fit, `rowH = floor((rowsH − 27 + 6) / 8) − 6` so 8 always show; `kioskFit` with the `+N MORE` line reserved; `k = rowH / 64`.
- Empty states from `gpuEmptyNote`.

**Notice:** `scanNotice`: the Scanlines frame (`scanSkin(3, 0.2)`) and `bsHeader('')` (the clock, the date and the plan's tabs: an empty plan can still hold selected tabs that are planned or unconfigured) with `NO SCREENS TO SHOW` (54 units, `soft`) and `CHOOSE SCREENS IN THE CONTROL PANEL` under it.

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

**Frame** (`vfdFrame`): menu from `kioskMenu(active)` in plan order: active → green with `▶ `, live with attention → amber (red for crit), live otherwise → blue, planned → ghost at 11 units; every item (live, inactive or planned) carries `kioskTabAttrs(t)`, as the PLAN check expects. Clock `HH:MM` (62) at the top right with the day (amber) and `D MON YYYY` (blue) under it; the gradient rule at 96; body from 108 to 12 from the bottom. `data-status` on the frame.

**Home Lab** (`vfdLabV2`): the four big counts (HOSTS, HEALTHY, WARN, ALERT; unlit ghosts when zero), the NORMAL / CAUTION / ALERT legend with one lit, `CHECKED <age> AGO`; hosts in a 3-column grid (30-unit rows, `data-host/up/health`): `▲` blue up, `▼` red down, `△` ghost unknown; the name in the health colour; `OK` / `WARN n` / `ALERT n` / `DOWN` / `--`. At most 4 grid rows: more than 12 hosts → 11 and `+N HOSTS`. The name is ellipsized in its cell. The alert list below, `AH = kioskH() − 108 − 12 − (84 + 10 + 32 × gridRows + 17)`, `kioskIssueLayout`, rows with `data-alert`. States: pending → the configured hosts stay in the grid with `△` and `--` (unknown), no legend lit, and `ACQUIRING TELEMETRY` (lit, dim green) in place of the checked line; no hosts → a centred lit note. Unconfigured → centred lit `HOME LAB NOT CONFIGURED`. Stale (legend lights `CAUTION`, the checked line reads `STALE · CHECKED <age> AGO` in amber, hosts and list at 0.55), no issues → `NO OPEN ALERTS` ghost-lit.

**Sessions** (`vfdSessionsV2`): rows `data-session`, name (25, amber waiting / dim idle / green), project (14), message for a waiting session (13, amber), the INPUT / WORK / SHELL / IDLE legend, tokens (`kioskTok`), agents (`--` for none), running time (first word of `sessAge`). Rows have a natural height (88 with a message line, 76 without) and a minimum (70 / 60). The row budget is `B = kioskH() − 108 − 12 − 30` (footer). The shown count is the largest `k` whose first `k` minimum heights sum to at most `B` (`+N MORE` lives in the footer, so it costs no row). If the natural heights of those rows fit, they are used; otherwise each row gets its minimum plus a share of the spare budget in proportion to `natural − minimum` (floored). At 576: `B = 426`, so even six message rows (6 × 70 = 420) show; seven all-message rows at 683 (`B = 533`) get 533 / 7 ≈ 76 each. footer `[+N MORE · ]FEED LIVE · HOST` and `N ACTIVE · n NEEDS INPUT`. States: offline (rows 0.45, footer `SESSION FEED OFFLINE · LAST UPDATE HH:MM` amber), pending, unconfigured, empty.

**GPUs** (`vfdGpusV2`): one budget `B = kioskH() − 108 − 12 − 30 (footer) − (stale ? 30 : 0) (banner)`; `capAll = floor(B / 40)`, `capMore = floor((B − 24) / 40)` (24 = the `+N MORE` line); `kioskFit`; `rowH = min(104, floor((B − (more ? 24 : 0)) / shown))`, never under 40 by construction. Three row forms: **big** (`rowH ≥ 80`, the mockup's three-line name cell with the legend), **normal** (56–79: name, model, the lit state word), **compact** (40–55: one line `HOST i · STATE`, model hidden, bars 10 high; the temperature cell keeps two lines, temperature 26 at line-height 1 over `MEM n°` 11 at line-height 1.1 with no gap (26 + 12.1 = 38.1 ≤ 40), so a valid MEM reading is never dropped; a cached row's `SEEN <age>` follows the state word). At 576 stale: `B = 396`, 9 rows of 44 all show. Rows `data-gpu-row="<host>|<index>"`: `HOST i` (+ short model, 13), the state (big rows: the BUSY / IDLE / THROT / HOT legend lit per state, critical lights HOT in red; states outside the four light their own `GPU_LABEL` word instead; normal and compact rows: only the lit word), LOAD and VRAM bars (`--` text and an empty bar when missing), temperature with `MEM n°` under it (`data-mem`), power `n W` and `OF n W` when the limit is known. A cached row (not fresh) dims to 0.6 and its state line adds `SEEN <age> AGO`. The footer `N GPUS · n BUSY · <gpuPowerText> · CHECKED <age>`, plus `NOT REACHED: …` when inventory is incomplete. Stale → a `TELEMETRY STALE · LAST UPDATE <age> AGO` line (amber) above the rows, counted in the height. Empty states from `gpuEmptyNote`, as a centred lit note.

**Notice:** `vfdNotice`: the frame (its menu from the plan's tabs, as on every screen) with `NO SCREENS TO SHOW` lit and the hint under it.

**Harness words** (every Home Lab fixture mapped to its own condition):
- `lit: true`: `has()` matches a word only inside a lit span (`data-lit[^>]*>[^<]*WORD`), so a ghost legend never satisfies it.
- `lab`: `FULL: 'NORMAL'`, `KIOSK_CALM: 'NORMAL'`, `HL_YELLOW: 'CAUTION'`, `HL_RED: 'ALERT'`, `HL_BUSY: 'ALERT'`, `HL_STALE: 'STALE · CHECKED'`, `HL_PENDING: 'ACQUIRING TELEMETRY'`, `HL_UNCONFIGURED: 'HOME LAB NOT CONFIGURED'`.
- `gpuWord`: busy `BUSY`, idle `IDLE`, throttling `THROT`, hot and critical `HOT`, others `GPU_WORDS[st]`; `legend: ['BUSY', 'IDLE', 'THROT', 'HOT']`.
- `status: { ok: '', warn: '', crit: '' }`; `memHas` on `data-mem`.

**State containers.** VFD marks where a state is shown, so the checks look only there: the Home Lab condition legend is `<div data-cond>`, each session row's legend `<div data-state>`, each GPU row's state cell `<div data-state>` (no nested divs inside them).

**Harness changes for lit looks** (written first, and shown to fail against deliberately wrong markup):
- One helper, `litIn(container, word)`: the container's markup (from its marker to its closing `</div>`) has `word` inside a `data-lit` span. `litOnly(container, word, legend)`: `word` is lit there and no other `legend` word is.
- Home Lab: for `NORMAL` / `CAUTION` / `ALERT`, `W.lab[fx]` is checked with `litOnly` in the `data-cond` container (`condWords`); other lab words (`STALE · CHECKED`, `ACQUIRING TELEMETRY`, `HOME LAB NOT CONFIGURED`) with `has()`.
- Sessions: in FULL, SESS_BUSY and SESS_MSG7, every `data-session` row's `data-state` container passes `litOnly` with the state's word (waiting `INPUT`, busy `WORK`, shell `SHELL`, idle `IDLE`).
- GPUs: the state sweep (~750) checks the row's `data-state` container with `litOnly(gpuWord(st))`.
- GPUs in the busy fixtures (GPU_HOUSE_BUSY, GPU_HOUSE_BUSY9, GPU_HOUSE_STALE11 at all four heights, so big, normal and compact rows): every visible row's `data-state` passes `litOnly` with its state's word.
- Home Lab stale lights only `CAUTION` in `data-cond`; pending lights none of the three.
- Negative self-tests, run once: a container where the expected word is only a ghost; one with the wrong legend word lit; one where the expected word is lit elsewhere in the row but not in the container. The same helpers must reject all three.
- The cached-critical assertion (~478) uses `W.gpuWord('critical')` (unchanged for every existing look: `CRITICAL`, or `critical` case-insensitively).
- Switch sequences: VFD → TNG → VFD, Scanlines → TOS → Scanlines and Scanlines lab → gpus → lab (the two raster variants) each equal a fresh render, and TOS stays golden.

- [ ] **Step 1: failing tests:** `screens.json`, words, test_devices list.
- [ ] **Step 2:** harness → FAIL (`REGISTRY`).
- [ ] **Step 3:** implement; regenerate the site bundle.
- [ ] **Step 4:** harness OK (golden: only added keys), pytest PASS, check_js OK.
- [ ] **Step 5:** commit `feat(kiosk): VFD Home Lab, Sessions and GPUs`.

### Task 4: Browser checks, parity, review

**Busy fixtures** (added in Task 2, `tests/js/fixtures.js`; new golden keys only):
- `HL_LONG12`: 12 hosts with long neutral names (`build-runner-eleven`, …), 15 issues across them, stale.
- `GPU_HOUSE_STALE11`: eleven GPUs on four hosts, stale (`published_at` older than `stale_after`), so every look's stale overflow path runs.
- `SESS_MSG7`: seven waiting sessions, each with a message.
They join `fit_check`'s default case matrix for every Kiosk theme (phase 1 looks included), so visibility is checked in a real browser, and the LOOKS block gains explicit assertions for them at 576, 600, 683 and 770: `HL_LONG12` shows all 12 hosts, at least 8 alerts in order and an exact `+N MORE`; `SESS_MSG7` at least 5 sessions in order and an exact count; `GPU_HOUSE_STALE11` at least 8 GPUs and an exact count.

**Empty plans.** The PLAN block renders an empty plan with `plan.notice` (today it calls `kioskNotice` directly), for both an empty selection and a selection with no live screens (e.g. only planned tabs); the notice keeps those tabs.

- [ ] `.venv/bin/ruff check` on changed Python files → clean.
- [ ] `fit_check` full matrix for `THEMES=Vintage/Scanlines,Vintage/VFD` (shapes and cases as phase 1) → 0 fail; 1-tab and 7-tab runs → ok.
- [ ] `preview_check` → every case ok (16 themes).
- [ ] `devices_check` → 19 steps ok (step 19 discovers the looks from `screens.json`).
- [ ] Parity: `parity.mjs out crt,vfd` (private tool, pinned engine on 127.0.0.2) → every frame's differing share and regions; fix or list each region over 0.5 %; rebuild the parity page with phases 1 and 2.
- [ ] Codex adversarial review of the branch until APPROVED; each finding fixed with a test that failed first.
- [ ] Publish the parity page (phases 1 and 2) for Rohan's sign-off.
- [ ] Deploy: Rohan authorised every step on 2026-10-24 ("Just go ahead with all steps"), so merge, push, CI green, `chiketi-site deploy server --dry-run`, then deploy; Go screenshots for both looks added to the parity page. His visual sign-off stays open on the page: anything he flags is a follow-up change.
