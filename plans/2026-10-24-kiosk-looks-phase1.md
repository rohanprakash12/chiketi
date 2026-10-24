# Kiosk Looks, Phase 1 (TNG, DS9, Terminal classic, Terminal distro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Kiosk screens (Home Lab, Sessions, GPUs) drawn in TNG, DS9, the six classic Terminal recolours and the four distro boards, each looking the way its agreed v4 mockup does, with the shared contracts (up/health, attention, plan-driven menus, landscape-only geometry) and the QA gates the spec requires.

**Architecture:**
- Server: Home Lab issues gain an additive `key`; an HTTP host answering non-200 moves from key `down` to key `api`.
- UI: one new shared module, `kiosk_looks.js` (geometry, attention, the Home Lab/Sessions/GPU adapters every look reads, the menu items), and one file per family, `kiosk_scifi.js` (TNG, DS9) and `kiosk_terminal.js` (classic, distro). `server.py` appends them to `screen_functions.js` wherever that is inlined, so the display, the control panel and the harness see one script.
- Each look is a port of its v4 prototype function (`chiketi-private/design/kiosk-looks/v4/proto/proto.js`) with px turned into `gq()`, 600 turned into `kioskH()`, and the mock data adapters (`pLab`, `pSess`, `pGpus`, `pAttention`) replaced by the real ones.
- QA: the harness becomes deterministic and pins today's output with golden hashes before any UI change; its Kiosk checks are discovered from `SCREEN_SPEC` and keyed to screen ids; a private parity tool renders prototype and build side by side with a diff heat map.

**Tech Stack:** Python 3.11+ (pytest), browser JS evaluated by the Node harness, Playwright (fit_check, devices_check, parity).

**Spec:** `specs/2026-10-24-kiosk-looks-design.md`

**Reference (private, not copied into this repo):** `../chiketi-private/design/kiosk-looks/v4/proto/proto.js`, functions `tngFrame`, `tngLabV2`, `tngSessionsV2`, `tngGpusV2`, `ds9Frame`, `ds9LabV2`, `ds9SessionsV2`, `ds9GpusV2`, `tclFrame`, `tclPanel`, `tclLabV2`, `tclSessionsV2`, `tclGpusV2`, `tdsFrame`, `pixClock`, `tgrad`, `tdsLabV2`, `tdsSessionsV2`, `tdsGpusV2`. Every visual value (colour, size, gap, radius, clip path, column template, letter spacing) not written in this plan comes from there, unchanged apart from the unit.

## Global Constraints

- Public repo: fixtures, specs and code use neutral names (`gpubox`, `devbox`, `Atlas`, `192.0.2.x`). No house host names.
- Harness rules: no layout `px` over 2 (every size through `gq(n)`, including clip paths, radii, grid templates, shadows); every data string through `esc()`; FULL defines every `m('ns.key')` read; no `undefined`/`NaN`/`[object Object]` in output.
- Units: a prototype `n`px becomes `gq(n)`. A prototype `600` (frame height) becomes `kioskH()`. No new layout reads `frameH()` or `fluidH()` directly.
- New Kiosk renderers call `bsFrame(body, 'landscape')` and are registered with `fluid: 'landscape'`.
- Order: alerts in the server's `issues` order (critical first, then oldest). No look re-sorts them. Sessions in `sessData()` order. GPUs in `gpuHouseData()` order (TNG groups by host: groups ordered by their first row).
- Capacities at 576 units: Home Lab 8 alerts in full (distro: every host up to 12), Sessions 5, GPUs 8, then `+N MORE` counting the hidden items of that kind.
- Clock `HH:MM`, never seconds, plus day and date, on every screen.
- TOS, Claude and every Self screen render byte-identical output to today (golden hashes), apart from the attention refactor, whose colours are asserted unchanged.
- Don't run `ruff format`. Restart the dev server after editing `assets/ui/*`. Throwaway `XDG_CONFIG_HOME` for dev servers.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01BmBXX8FiZQeTmh7ahaTUZ1`.

## Review Focus

1. A host whose probe login fails (key `down`) while its other issues are frozen shows a red up lamp and DOWN health, and a host whose HTTP API answers 401 (key `api`) shows up (blue) with ALERT health. Task 1 and Task 4 tests.
2. A device with a reordered or single-screen selection gets menus in that order with only live screens tappable, in every new look. Task 9 PLAN sweep over all Kiosk themes.
3. Switching TNG → Terminal/amber → TNG gives the same TNG output as rendering it fresh, and leaves TOS byte-identical. Task 4 and Task 9 switch tests, Task 2 golden hashes.
4. A busy day (15 alerts, 8 GPUs on 4 hosts, 6 sessions with messages) at 576 units shows at least the capacities above and a correct `+N MORE`, with nothing overflowing. Task 5–8 harness capacity checks, Task 9 fit_check.
5. Hostile host, issue, session and GPU strings never become markup in the new looks, including inside the padded fixed-width Terminal columns (padding must count the raw string, then escape). Task 3 hostile sweep over every Kiosk theme, Task 7–8 pad tests.

---

### Task 1: Issue keys (`key` field, `api` for HTTP non-200)

**Files:**
- Modify: `chiketi/collectors/homelab/rules.py` (`IssueTracker.issues`)
- Modify: `chiketi/collectors/homelab/checks.py` (`evaluate_http`)
- Test: `tests/test_homelab_rules.py`, `tests/test_homelab_checks.py`

**Interfaces:**
- Produces: every issue dict is `{"host", "key", "severity", "title", "detail", "since"}`; `key` is the condition key (`down`, `gw`, `api`, `fs:/`, `gpu_temp:0`…).

- [ ] **Step 1: failing tests.** In `test_tracker_hold_and_clear` the expected dict gains `"key": "fs:/"`. In `test_http_ok_and_401`: `assert c.key == "api" and "401" in c.title and c.severity == "crit" and c.hold == HOLD_DOWN`. New `test_issue_keys_for_reachability`: a tracker fed `down("timed out")` (partial) HOLD_DOWN times, a `Condition("gw", …)` and an HTTP 500 condition reports keys `down`, `gw`, `api`.
- [ ] **Step 2:** `.venv/bin/python -m pytest -q tests/test_homelab_rules.py tests/test_homelab_checks.py` → FAIL on the missing key / `down != api`.
- [ ] **Step 3: implement.** `issues()` emits `"key": k` from the tracker key; `evaluate_http` returns `Condition("api", "crit", f"API answered {status}", host.url, HOLD_DOWN)`.
- [ ] **Step 4:** same command → PASS; then the whole suite (`-q`) → PASS (any other test comparing issue dicts gains the key).
- [ ] **Step 5:** commit `feat(homelab): issues carry their condition key; HTTP non-200 is key api`.

### Task 2: Deterministic harness and golden hashes of today's output

Done before any UI change, so the hashes are of today's code.

**Files:**
- Modify: `tests/js/render_harness.js` (top: clock, TZ, random; bottom: golden check)
- Create: `tests/js/golden.json`

**Interfaces:**
- Produces: `HARNESS_NOW_MS = Date.UTC(2026, 9, 24, 14, 3, 0)`; `Date.now()` and `new Date()` return it (a `Date` subclass installed before `require('./fixtures.js')`); `process.env.TZ = 'UTC'` set before the first `Date` use; `seedRandom(n)` replaces `Math.random` with mulberry32; `goldenRender(fnName, html)`; env `GOLDEN=update` rewrites `golden.json`.
- Golden set: every Self renderer of every theme (`screen1..5`), and the TOS and Claude Kiosk renderers (`lab`, `sessions`, `gpus`), for every fixture, at frame heights 600, 683 and 246, with no tab plan and with the plan `['lab','sessions','gpus']`; `kioskNotice` for Sci-Fi and Others at 600 and 246. Key `fixture|h|plan|family/variant|id`, value sha1 of the HTML (seeded random reset to 1 before each render).
- Volatile markup excluded from the hash: none expected once the clock and random are fixed; if a renderer still differs between two runs, the harness fails with the key (no allowlist).
- The hostile payload is normalised **before** the baseline is captured (Codex plan r1 #8): `PAYLOAD`, the fixture `XSS` and the literal in `HOSTILE` all become `<video src=x onerror=alert(1)>`, and the "renderer emits the payload tag" guard checks `video`. Later tasks may only **add** golden keys (new fixtures, captured against unchanged renderers); a changed hash for an existing key fails.

- [ ] **Step 1:** add the frozen clock, TZ and seeded random; add the golden pass; run `GOLDEN=update node tests/js/render_harness.js` → writes `golden.json`; run it again without `GOLDEN` twice → identical, `renderer harness OK`.
- [ ] **Step 2: prove it bites.** Temporarily change one letter in `bsHeader`'s day names; run → FAIL listing golden keys; revert.
- [ ] **Step 3:** commit `test(harness): frozen clock and seeded random; golden hashes of today's screens`.

### Task 3: Harness gates that cover new themes

**Files:**
- Modify: `tests/js/render_harness.js`, `tests/js/fixtures.js`

**Interfaces:**
- `KIOSK_THEMES` = every `[family, variant]` with `themeAllowed('kiosk', key)`, from `SCREEN_SPEC` and the theme list.
- Semantic checks (banner words, order, MORE, fluid) keyed by screen id `lab`/`sessions`/`gpus` from `REGISTRY`, not by `/Homelab$/` etc. on function names. The want-words become per-idiom sets: each look declares its words in `KIOSK_WORDS[lookKey]` (exported via `__HARNESS`), e.g. TNG `HL_RED: 'RED ALERT'`, Terminal `HL_RED: 'red'` (case-insensitive match where the look is lower-case).
- `layoutOf(html)`: `'strip'` iff the frame carries class `strip`, else `'full'`; the MEM-in-strip rule uses it, not `layoutClass()`.
- Image rule: every `<img` must have `src` under `/assets/tubes/` and only `src|alt|style|class` attributes (phase 1 emits none; the rule is in place for phase 3).
- New fixtures: `KIOSK_CALM` (Home Lab ok, sessions all working or idle, GPUs idle/busy: every screen calm), `GPU_HOUSE_BUSY9` (9 GPUs on 4 hosts), `HL_BUSY` (15 issues on 9 hosts incl. one `down`, one `api`, one `gw`, crit first then oldest, `key` on every issue), `HL_UNKNOWN` (a host with `state: 'unknown'`), `GPU_HOUSE_BUSY` (8 GPUs on 4 hosts), `SESS_BUSY` (6 sessions, 2 with messages). Every existing Home Lab fixture's issues gain a `key`.
- Shape sweep: every Kiosk renderer × every fixture × heights {246, 576, 600, 683, 770, 1200}.

- [ ] **Step 1:** make the changes with only TOS and Claude in the Kiosk allowlist; run harness → OK; `GOLDEN=update` adds keys for the new fixtures only (`git diff tests/js/golden.json` shows additions only: existing fixtures' new `key` field is not read by today's renderers, so their hashes stand — if a hash moves, the fixture change is wrong).
- [ ] **Step 2: prove discovery.** Temporarily add `Sci-Fi/TNG` to `modes.kiosk.themes` without renderers → harness FAILS `no Kiosk renderer for lab`; revert.
- [ ] **Step 3:** commit `test(harness): Kiosk checks discovered from SCREEN_SPEC, keyed by screen id; video payload; busy fixtures`.

### Task 4: Shared Kiosk core (`kiosk_looks.js`)

**Files:**
- Create: `chiketi/assets/ui/kiosk_looks.js`
- Modify: `chiketi/server.py` (`_screen_functions_js` appends `KIOSK_JS = ("kiosk_looks.js", "kiosk_scifi.js", "kiosk_terminal.js")`; `_DISPLAY_ASSETS` includes them), `chiketi/assets/ui/screen_functions.js` (`bsFrame` landscape flag, `bsTabAttention` on `kioskAttention`, `screenRenderer` fluid from the registry entry, `DISTRO_SKINS` roles), `tests/js/render_harness.js` (eval the three files after `screen_functions.js`), `tests/test_server*.py` (inlined pages contain the new files; build hash changes when one does)
- Test: harness unit block "KIOSK CORE"

**Interfaces (Produces):**
- `kioskH()` → `FRAME_H` when `layoutClass()==='landscape'`, else `600`.
- `bsFrame(body, 'landscape')` → class `screen-frame fluid` only when `layoutClass()==='landscape'`; otherwise a fixed 1024×600 frame (so the display and the previews letterbox it with no change to `display_app.js`/`control_app.js`).
- `kioskAttention()` → `{ lab: 'crit'|'warn'|null, sessions: 'warn'|null, gpus: 'crit'|'warn'|null }` with today's inputs and precedence (`lab`: crit→crit, warn/stale→warn; `sessions`: offline or any waiting→warn; `gpus`: only when Home Lab configured, from `gpuStatusColor` crit/warn).
- `bsTabAttention()` → `{ id: S.crit|S.warn|null }` mapped from `kioskAttention()`; colours unchanged (asserted).
- `kioskWorst()` → `'crit'|'warn'|'ok'`: worst of `kioskAttention()` over the plan's live tabs (`bsTabList()` entries with `built`).
- `kioskLab()` → `{ mode, hosts: [{ name, state, up: true|false|null, health: 'ok'|'warn'|'crit'|'down'|'unknown', n, issues }], issues, counts: { ok, warn, crit, down }, checkedAt, stale }`; `up` is `null` (unknown) when mode is `pending`/`unconfigured` or the host state is `unknown`; `false` while an issue on that host has key `down` or `gw`; `health` is `down` when `up === false`.
- `kioskSess()` → `sessData()` plus `{ waiting, host, checkedAt, counts }`.
- `kioskGpus()` → `gpuHouseData()` plus `rows[i].short` (model without vendor prefix, `-PCIE-nnGB` removed, upper case), `busy`, `hot`, `idle`, `powerText` (`gpuPowerText`).
- `kioskMenu(active)` → `[{ key, label, live, active, att: 'crit'|'warn'|null, screen }]` from `bsTabList()` and `kioskAttention()`.
- `kioskClock()` → `{ hm, day, date, short, year }` from the frozen-able `Date`.
- `kioskFit(n, capAll, capMore)` → `{ shown, more }`: `capAll` is how many fit with no `+N MORE` line, `capMore` how many fit with that line's space reserved (the line never takes an item's slot, Codex plan r1 #1); `n <= capAll` → all, else `shown = capMore`, `more = n - capMore`. Each layout sizes itself so that at 576 `capMore` ≥ the spec capacity.
- Kiosk skins (Codex plan r1 #3): `KSKIN.tng`, `KSKIN.ds9` and `kioskTermSkin(c)` (cached per palette) are `Object.freeze`d copies of `BS_SKIN_TOS` with the look's `bg` and `font`, no `defs`/`overlay`/`frameCss`/`contentFilter`. Every new renderer and notice calls `bsSkin()` with its skin first, before any attention, menu or frame helper. Shared `BS_SKIN_*` objects are never written.
- Renderer metadata (Codex plan r1 #6): each `KIOSK_RENDERERS` entry may carry `fluid`; `screenRenderer` returns `fluid: k.fluid === undefined ? true : k.fluid`. TOS and Claude carry none (true); the new entries carry `'landscape'`. Asserted for both metadata and the frame class.
- Notices (Codex plan r1 #4): `screenPlan()` adds `plan.notice`, the empty-plan renderer for that family and variant (`kioskNoticeFor(family, variant)`: the new looks' own notice, else today's `kioskNotice`). `display_app.js` and `control_app.js` draw `plan.notice` instead of their `NOTICE.fn`; the harness does the same. No global variant state is read.
- `pad(s, n)`, `lpad(s, n)`: pad/truncate the raw string by code points, then `esc()` (callers never pad escaped text).
- `DISTRO_SKINS[*]` gain `warnA`, `crit`, `ok`, `off`, `ghost`, `ghostText`; Arch gets the prototype's exact values (`#e5c07b`, `#e06c75`, `#7fb87f`, `#13202a`, `#1c2a35`, `#2e4352`).

- [ ] **Step 1: failing harness unit tests** (KIOSK CORE): `kioskH()` at 683/1200/246 → 683/600/600; `bsFrame('x','landscape')` fluid at 683, not at 246 or 1200; `kioskLab()` on `HL_BUSY` → the `down` and `gw` hosts `up===false`, health `down`; the `api` host `up===true`, health `crit`; on `HL_PENDING` every `up===null`; on `HL_UNKNOWN` that host `up===null`, health `unknown`; `bsTabAttention()` colours for FULL/HL_RED/HL_YELLOW/HL_STALE/SESS_OFFLINE/GPU_HOUSE/GPU_HOUSE_STALE equal the pre-change values (literal expected colours from `BS_SKIN_TOS`); `pad('<b>',5)` → `'&lt;b&gt;  '`; `kioskFit(15,8)` → `{shown:7, more:8}`.
- [ ] **Step 2:** harness → FAIL (`kioskH is not defined`).
- [ ] **Step 3:** implement; `screenRenderer` returns `fluid` from `KIOSK_FLUID[key] || true` for Kiosk renderers.
- [ ] **Step 4:** harness → OK including golden; pytest → PASS; `check_js.sh` → ok.
- [ ] **Step 5:** commit `feat(kiosk): shared Kiosk core: kioskH, attention, up/health, menus, landscape frames`.

### Task 5: TNG (`kiosk_scifi.js`)

**Files:** Create `chiketi/assets/ui/kiosk_scifi.js`; modify `tests/js/render_harness.js`.

**Interfaces:** `tngHomelab(c)`, `tngSessions(c)`, `tngGpus(c)`, `tngFrame(active, title, summary, body)`, `TNG_K` (the prototype `TNG` palette), `TNG_STATUS`. Registered in `KIOSK_RENDERERS['Sci-Fi/TNG']` in Task 9 (the harness unit tests here call the functions directly).

Port notes (beyond the global unit rules):
- `tngFrame`: elbow and top bar colour `TNG_STATUS[kioskWorst()]`; the title-gap formula `title.length * 11 + 34` stays (in `gq`); sidebar buttons from `kioskMenu(active)`: built tabs 40 tall / 19, planned 28 / 13 at 0.6 opacity, colour gold (active) / red (crit) / peach (warn) / lilac / `#3d3352` (planned); each carries `data-tab` and, when live, `data-screen`. With more than 7 tabs or a short frame the buttons keep their size (7 fit at 576).
- `tngHomelab`: system rows from `kioskLab().hosts`, left cap blue (up), red (down), `#3d3352` (unknown); health cap width 98, words HEALTHY / WARN n / ALERT n / DOWN / `--` (unknown, dim); stale: both caps at 0.45 opacity and the summary segment `TELEMETRY STALE` (warn colour). Alerts: `pIssueLayout(n, AH)` with `AH = kioskH() - 32 - 44 - (n <= 4 ? 234 : 192) - 34`, recomputed for host rows beyond 3 (each extra row of systems takes `SH + 6` from `AH`), capped so 8 alerts always show at 576 (two columns of 4 rows minimum). Mode words in the first summary segment: `ALL SYSTEMS NOMINAL`, `CONDITION YELLOW`, `RED ALERT`, `TELEMETRY STALE`, `ACQUIRING TELEMETRY` (body empty, centred), and `HOME LAB NOT CONFIGURED`. Calm (no issues): the ALERTS header with `0 OPEN` and the words `NO OPEN ALERTS` in dim. Times are `hlClock(since)`. `CHECKED n S AGO` from `hlAgo`.
- `tngSessions`: as prototype, rows from `kioskSess()`, capacity `kioskFit(n, fit)` with `fit` from `kioskH()` (row 68/80 + 6), at least 5 at 576; states pending/offline/empty/unconfigured as centred words `CONNECTING TO SESSION FEED`, `SESSION FEED OFFLINE` (+ last update in the summary), `NO ACTIVE SESSIONS`, `SESSION FEED NOT CONFIGURED`; offline rows at 0.45 opacity. Tokens `fmtTok`, ages `sessAge`.
- `tngGpus`: groups by host in `kioskGpus().rows` order; group heading 30 tall (pill 24 + 6), row height `max(40, min(78, floor(avail / n)))` with `avail = kioskH() - 76 - groups * 30 - (overflow ? 26 : 0)`; rows under 46 use the compact type (GPU 20, values 17). At 576 eight rows on four hosts fit (`500 - 120 = 380 ≥ 8 × 40`); with nine on four hosts, eight show and `+1 MORE` (tested, Codex plan r1 #1). `--` for any null value (never 0), bars at 0 width for null; stale/offline rows 0.6 opacity with `SEEN … AGO` under the state pill; empty notes from `gpuEmptyNote`; summary `n GPUS`, `n BUSY`, `n HOT/THROTTLING`, `powerText`, `CHECKED …` (real `published_at` age).

- [ ] **Step 1: failing tests** (harness block "TNG"): for KIOSK_CALM, FULL, HL_RED, HL_BUSY, HL_PENDING, HL_STALE, HL_UNCONFIGURED, SESS_*, GPU_HOUSE*, at 576/600/683/770: renders, words present, `data-tab` order = plan, alert order = fixture order (host+title sequence), at 576 HL_BUSY shows ≥ 8 alert rows and `+N MORE` with N = 15 − shown, SESS_BUSY ≥ 5 rows, GPU_HOUSE_BUSY ≥ 8 rows; HL_BUSY's `down` host row has the red cap and `DOWN`; elbow colour red for HL_RED, yellow for HL_YELLOW and for FULL (its waiting session, with Sessions in the plan), lilac for KIOSK_CALM and for FULL with a plan of `['lab','gpus']` (an unselected screen's warning does not count, Codex plan r1 #7); GPU_HOUSE_BUSY 8 rows at 576, GPU_HOUSE_BUSY9 8 rows and `+1 MORE`; after a Self Scanlines render, each TNG screen equals its fresh render and `BS_SKIN_SCAN`/`BS_SKIN_TNG` are unchanged (deep-equal to snapshots taken at load).
- [ ] **Step 2:** harness → FAIL (`tngHomelab is not defined`).
- [ ] **Step 3:** port.
- [ ] **Step 4:** harness → OK.
- [ ] **Step 5:** commit `feat(kiosk): TNG Home Lab, Sessions and GPUs`.

### Task 6: DS9 (`kiosk_scifi.js`)

**Interfaces:** `ds9Homelab(c)`, `ds9Sessions(c)`, `ds9Gpus(c)`, `ds9Frame(active, body, foot)`, `D9_K`.

Port notes:
- `ds9Frame`: 6-unit top bar `{ok: teal, warn: '#F2A33A', crit: '#FF3B30'}[kioskWorst()]`; chips from `kioskMenu(active)` (triangle only on built tabs; planned chips `#171b22` / `#3b4252`); clock `HH:MM` with orange colon, day · date under it.
- `ds9Homelab`: left column condition word GREEN / YELLOW / RED / STALE / PENDING (`--`), counts HEALTHY / REPORTING / SYSTEMS, host chips with two signals (Codex plan r1 #2): the triangle is **up** (teal up, red down, dim unknown); the chip's text, tint and right-hand word are **health** (steel and no word when healthy, orange `n` warn, red `n` alert, red `DOWN` when down, dim `--` unknown). An `api` host: teal triangle, red health. Stale: both dimmed to 0.45, values kept. Right: cards up to 4, compact rows beyond, rows = `min(n, floor((AH - 8) / 22))` with `AH = kioskH() - 156`, last row `+N MORE`. Calm: `NO OPEN ALERTS`.
- `ds9Sessions`: angled cards; capacity from `kioskH()` (row 60/72 + 6), ≥ 5 at 576; states as TNG's words.
- `ds9Gpus`: left array summary (CARDS, ACTIVE, HOT/THROT, POWER DRAW with `powerText`, the skewed bar of drawn ÷ rated when both known, HOTTEST from the hottest fresh row, `--` when none); right rows `rowH = min(116, floor(AH / n) - 6)`, compact under 90, minimum 44, beyond that `+N MORE`.

- [ ] Steps 1–5 as Task 5, block "DS9" (words, order, capacities at 576, top bar teal for KIOSK_CALM, amber for FULL, red for HL_RED; host chips for `down`, `gw`, `api`, unknown and stale as above; Self Scanlines → DS9 → fresh equality), commit `feat(kiosk): DS9 Home Lab, Sessions and GPUs`.

### Task 7: Terminal classic (`kiosk_terminal.js`)

**Interfaces:** `tclHomelab(c)`, `tclSessions(c)`, `tclGpus(c)`, `tclFrame(active, panels)`, `tclPanel(x, y, w, h, title, right, lines)`, `TCL_TONES[variant]` = `{ bar, ink, bright, soft, soft2, bad }` (cyan = the prototype's `#00384a`, `#001018`, `#e6faff`, `#cfefff`, `#9fe9ff`, `#ff5555`; the other five hand-matched to their palettes), registered per variant via `tclFor(variant)` wrappers `tclCyanHomelab` … `tclHackerGpus`.

Port notes:
- Colours: `C` is the theme palette passed in (`c`), not `themeData.families.Terminal.cyan`.
- Status line: `[chiketi]` session name, windows `k:id` from `kioskMenu(active)` (k = position in the plan), current `k:id*` filled, `#` after a live window that needs attention (not after every live window), planned windows dim, then day, date and time on the right.
- Lines are built from raw strings with `pad`/`lpad`, never padding escaped text.
- Home Lab: STATUS panel (condition green/yellow/red/stale/pending, counts, `checked …`), HOSTS panel in three columns (`▲` up, `▼` down, `?` unknown; `ok`/`warn`/`ALERT`/`DOWN`/`--`), panel height from host rows; ISSUES panel fills the rest, `rows = floor((h - 12 - 25) / lineH) - 1` with the roomy 23/34 type when n ≤ 6, then `+N more`.
- Sessions: SESSIONS panel lines from `kioskSess()`, capped to the panel's line count (messages take a line), `+N more`; FEED panel from real data (source host, clients = distinct `tool` values, `updated n ago` from `sessions.checked_at`, state ok/offline/pending); TOKENS panel from real per-state token sums with bars scaled to the largest.
- GPUs: the nvidia-smi style table (row per GPU, `--` for nulls, `MEM` column `-` when absent), LOAD panel bars below; table rows capped so the LOAD panel keeps ≥ 3 lines; `+N more` in both.

- [ ] Steps 1–5 as Task 5, block "TCL" (all six variants: words lower-case where the look is, alignment: every table line of the ISSUES panel has the same visible length for HL_HOSTILE, i.e. padding counted on raw text), commit `feat(kiosk): Terminal classic Home Lab, Sessions and GPUs`.

### Task 8: Terminal distro (`kiosk_terminal.js`)

**Interfaces:** `tdsHomelab(c)`, `tdsSessions(c)`, `tdsGpus(c)`, `tdsFrame(active, body)`, `pixClock(hm)`, `tgrad(frac, n)`, wrappers per distro (`tdsArchHomelab` …) setting `_distroName`.

Port notes:
- Skin roles from `distroSkin()` (`accent`, `meter`, `label`, `value`, `dim`, `bg`, `warnA`, `crit`, `ok`, `off`, `ghost`, `ghostText`) replace the prototype's literals.
- Header: pixel clock, `DAY d MON yyyy`, `chiketi · <sys.hostname>`; tabs `¹…⁷` by plan position from `kioskMenu`, current filled, amber border/text on attention.
- Home Lab: the host summary (every host up to 12, `+n more hosts` beyond): name, up/down/`?`, healthy/warn/alert/down/`--`, worst issue title (the host's first issue in server order) and `+k` for the rest; the detail block for n ≤ 4.
- Sessions: as prototype with real state counts in the summary line; token bar scaled to the largest; capacity from height, `+N more`.
- GPUs: two lines per GPU (one blank line between when ≤ 4), capacity from height, `+N more`; `--` for nulls.

- [ ] Steps 1–5 as Task 5, block "TDS" (four distros, host summary shows all 9 hosts of HL_BUSY with `+k`), commit `feat(kiosk): distro board Home Lab, Sessions and GPUs`.

### Task 9: Enable the themes; notice; plan and switch sweeps; browser checks

**Files:**
- Modify: `chiketi/assets/ui/screens.json` (`modes.kiosk.themes` += `Sci-Fi/TNG`, `Sci-Fi/DS9`, `Terminal/cyan`, `Terminal/amber`, `Terminal/phosphor`, `Terminal/red_alert`, `Terminal/blue`, `Terminal/hacker`, `Terminal/Arch`, `Terminal/Ubuntu`, `Terminal/openSUSE`, `Terminal/Mandriva`), `screen_functions.js` (`KIOSK_RENDERERS` entries, `kioskNotice` dispatch), `kiosk_scifi.js`/`kiosk_terminal.js` (notice in each idiom), `scripts/fit_check.mjs` (Kiosk themes from `screens.json`, shapes incl. 1024×576/600/683/770 and 1920×462 and 1024×1400, image-load check), `scripts/devices_check.mjs` (a step: set a device to `Terminal/amber` in Kiosk, reload, the display draws `tclAmberHomelab`), `tests/test_screens.py` / `tests/test_devices*.py` (a device accepts each new theme in Kiosk and keeps it across a reload of state).
- Modify: `display_app.js`, `control_app.js` (draw `plan.notice`).
- Create: `scripts/preview_check.mjs` (control panel `/`: for every Kiosk theme, plans FULL-3, one tab, none; selects the theme by calling the page's own `selectTheme`-free path `selectedFamily/selectedVariant` + `renderScreens()`, then asserts each preview frame rendered the theme's renderer (a `data-look` attribute on the frame root), no overflow past the preview box, and the empty plan shows the theme's notice).
- `fit_check.mjs` default cases (Codex plan r1 #5): for every Kiosk theme, `lab:{KIOSK_CALM,FULL,HL_RED,HL_BUSY,HL_PENDING,HL_STALE,HL_UNCONFIGURED,HL_HOSTILE}`, `sessions:{FULL,SESS_BUSY,SESS_MANY,SESS_OFFLINE,SESS_EMPTY,SESS_PENDING,SESS_HOSTILE}`, `gpus:{GPU_HOUSE,GPU_HOUSE_BUSY,GPU_HOUSE_BUSY9,GPU_HOUSE_MANY,GPU_HOUSE_OLD,GPU_HOUSE_STALE,GPU_HOUSE_NONE,GPU_HOUSE_HOSTILE}`, at 1024×576, 1024×600, 1024×683, 1024×770, 1920×462 (letterboxed) and 1024×1400 (other, letterboxed); TABS 1, 3 and 7.
- The display reload test is parameterised over all twelve new themes (`devices_check` step: set the device theme, reload, the frame carries that look's `data-look`).
- Every new renderer's frame root carries `data-look="<family>/<variant>"` (the browser checks read it).
- Harness: PLAN sweep over every Kiosk theme (one tab, seven tabs, reordered, none, and none right after selecting the theme with no other render first); switch sequences A→B→A for (TNG, Terminal/amber), (DS9, Arch), (Terminal/cyan, Others/Claude), (Arch, Sci-Fi/TOS), (Self Vintage/Scanlines, each new look) equal to fresh renders; capacity sweep at 576.

- [ ] **Step 1:** failing tests (harness REGISTRY: allowlist themes have Kiosk renderers; pytest: theme accepted).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** wire up.
- [ ] **Step 4:** harness OK, pytest PASS, check_js ok, ruff clean on changed Python; dev server → `fit_check` for every Kiosk theme × cases × shapes → no overflow; `devices_check` → 19 steps pass.
- [ ] **Step 5:** commit `feat(kiosk): TNG, DS9, Terminal classic and distro boards in Kiosk mode`.

### Task 10: Parity pages (private repo)

**Files (chiketi-private):** `design/kiosk-looks/parity/parity.mjs`, `parity/build.py`, `parity/template.html`, output `parity/phase1/`.

- Renders, for each look (tng, ds9, tcl = Terminal/cyan, tds = Terminal/Arch) × frame (lab, lab15, sessions, gpus, gpus7), the prototype (v4 `proto.js` on a dev server running the pinned main `9bb3f6b` from a temporary worktree) and the build (the branch's dev server, device in Kiosk with that theme), same `data.cjs` metrics, `Date` frozen by `addInitScript`, animations and transitions off, fonts ready, 1024×600 at 2×.
- Data-adapter shims in the prototype page only (listed on the page): issues kept in server order instead of the prototype's newest-first sort; the prototype's hard-coded `CHECKED 12S AGO`/token panel numbers left as they are and listed.
- Diff: per pixel max channel difference after a 1-unit blur, tolerance 8/255; heat map PNG; share of differing pixels per frame and per 64×64 region; regions over 0.5 % listed with a reason or fixed.
- Page per look: mockup, build, heat map, numbers, reasons. Published as an artifact for Rohan's sign-off.

- [ ] Run, inspect every heat map, fix build differences that are not data, re-run until every remaining region has a written reason; publish; commit in chiketi-private.

### After the tasks

- Codex adversarial review of the branch against spec and plan, iterate to `VERDICT: APPROVED`, each accepted finding fixed test-first.
- Ask Rohan before deploying (site `--dry-run` first); push only with his OK. Go screenshots after deploy go onto the parity page.
