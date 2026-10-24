# GPUs amendment (spec §6) Implementation Plan

> **For agentic workers:** executed inline (executing-plans), TDD per step, Codex review of the
> plan and of the branch until approved.

**Goal:** a GPU's throttling is judged over its last few polls, the row shows the memory
temperature, and cards are identified by UUID. Spec §6 of `specs/2026-10-24-gpus-screen-design.md`.

**Architecture:** the probe adds a UUID field and an optional, budgeted memory-temperature query.
The parser carries both through. The poller keeps a short, monotonic-timed, identity-checked
throttle history per GPU, plus an unresolved-throttling flag, and builds the GPU conditions
itself. The screen adds a `MEM` line in the full layout.

**Tech stack:** POSIX sh, Python 3.11 (pytest), plain JS (render harness), Playwright
(fit_check).

**Spec:** `specs/2026-10-24-gpus-screen-design.md` §6 (binding over §§1–4 where they differ).

## Global Constraints
- The repo is public: tests and fixtures use neutral names (gpubox, devbox) and 192.0.2.x only.
- The probe stays read-only, POSIX sh and shellcheck-clean. It runs no new unbounded call, and
  prints no process names or PIDs.
- Constants: history length 4; "recent" = any of the last 3; "qualifies" = at least 3 of 4;
  age limit `4 × (1.1 × poll_seconds + ceil(hosts / 8) × 40)` on `mono`.
- Memory query: limited to 3 s, KILL 1 s later; it runs only when 0 ≤ elapsed < 20 by
  `/proc/uptime`, and only where `timeout` exists.
- `mem_temp` is valid in −50…200 °C. UUID: `|`, `=` and spaces stripped, at most 64 characters.
- Don't run `ruff format`; add no new ruff findings.

## Review Focus
1. A raised throttling alert cleared by a sample that cannot show recovery (legacy, no mask, unreadable), whatever its title was in between.
2. Old evidence (expired, or from another card) making a row THROTTLING or raising an alert.
3. The memory query delaying or breaking the main sample (failure, a hang, no `timeout`, a slow host).
4. An 11-field `gpu=` line from an already-installed v2 probe failing to parse.
5. A `MEM` line overflowing its fixed-width cell, or showing `--`, `NaN` or a hostile value.

---

### Task 1: Probe (`chiketi/assets/probe/chiketi-probe`)

**Files:** modify the probe; test `tests/test_homelab_probe_script.py`.

- [ ] **Step 1: failing tests** (in `_controlled_probe`, add `CHIKETI_PROBE_UPTIME` to `env`
  when a test passes `uptime=`; the fake uptime is a script-written file, so a test can switch
  its content between reads. Use a fake `nvidia-smi` that rewrites it on its first call, so the
  start read and the gate read differ):
  - `test_gpu_lines_carry_uuid`: the fake returns 12 fields, ending `GPU-aaaa-bbbb`. `gpu=` has
    12 `|`-separated fields, the last `GPU-aaaa-bbbb`, and the query args contain `,uuid`.
  - `test_mem_temp_lines_last`: the fake answers `--query-gpu=pci.bus_id,temperature.memory`
    with `00000000:01:00.0, 84` and `00000000:02:00.0, [N/A]`. Exactly one
    `gpu_mem_temp=00000000:01:00.0|84`, and it comes after the `failed_units=` line (when
    systemctl exists) and after every other line.
  - `test_mem_query_failure_keeps_sample`: the memory query exits 6. The `gpu=` and `gpu_procs`
    lines are unchanged, and there is no `gpu_mem_temp`.
  - `test_no_timeout_no_mem_query`: `with_timeout=False`; no memory-query args are logged.
  - `test_mem_gate`: uptime 100 at the start, then 119 → the query runs; 100 then 120 →
    skipped; 100 then 90 → skipped; `abc` → skipped; a missing file → skipped.
  - `test_mem_query_hang_cut_off`: the memory query sleeps 30 s; the probe ends within 8 s and
    still prints the main sample.
  - Update the existing tests' `ROW*` and fake outputs to 12 fields, and update the
    `len(args) == 2` assertion (the memory query is a third call).
- [ ] **Step 2:** run `.venv/bin/python -m pytest -q tests/test_homelab_probe_script.py`.
  Expected: the new tests fail.
- [ ] **Step 3: implement**
  - near the top: `UP=${CHIKETI_PROBE_UPTIME:-/proc/uptime}` and
    `up() { awk '$1 ~ /^[0-9]+(\.[0-9]+)?$/ { print int($1) }' "$UP" 2>/dev/null; }`;
    `START_UP=$(up)`.
  - the detailed query: `$F,<throttle name>,pci.bus_id,uuid` (both the first try and the
    retry). awk requires `NF == 12`; `uid = $12; gsub(/[|= ]/, "", uid); uid = substr(uid, 1, 64)`;
    print a 12th field. Set `NV_OK=1` when the query succeeded.
  - the last block before `exit 0`:
    ```sh
    if [ "${NV_OK:-0}" = 1 ] && command -v timeout >/dev/null 2>&1; then
      now_up=$(up)
      if [ -n "$START_UP" ] && [ -n "$now_up" ]; then
        el=$((now_up - START_UP))
        if [ "$el" -ge 0 ] && [ "$el" -lt 20 ]; then
          mout=$(timeout -k 1 3 nvidia-smi --query-gpu=pci.bus_id,temperature.memory --format=csv,noheader,nounits 2>/dev/null) &&
            printf '%s\n' "$mout" | awk -F', ' 'NF == 2 { b = $1; gsub(/[|= ]/, "", b); t = $2; gsub(/^ +| +$/, "", t)
              if (b != "" && t ~ /^-?[0-9]+(\.[0-9]+)?$/) print "gpu_mem_temp=" b "|" t }'
        fi
      fi
    fi
    ```
  - Update the GPU comment block: three query forms, and the memory query's own budget.
- [ ] **Step 4:** the same pytest, plus `shellcheck -s sh chiketi/assets/probe/chiketi-probe`.
  Expected: all pass.
- [ ] **Step 5:** commit `feat(probe): card UUID and a budgeted memory-temperature query`.

### Task 2: Parser and baseline (`probe.py`, `rules.py` Baseline)

**Interfaces:** produces `Gpu.uuid: str = ""` and `Gpu.mem_temp: float | None = None`.

- [ ] **Step 1: failing tests** in `tests/test_homelab_probe.py`:
  - a 12-field `gpu=` line gives `uuid`;
  - an 11-field line still parses with `uuid == ""`;
  - 10 and 13 fields are dropped;
  - `gpu_mem_temp=<BUS upper>|84` matches the lower-case bus id → `mem_temp == 84.0`;
  - `|nan`, `|250` and `|-60` give None;
  - no line gives None;
  - a `gpu_mem_temp` line for an unknown bus is ignored.

  In `tests/test_homelab_rules.py`: a remembered GPU with `mem_temp` and `uuid` round-trips;
  an old record without either key loads with defaults; `mem_temp: "x"`, `inf` or `uuid: 5`
  rejects the record.
- [ ] **Step 2:** run them. Expected: FAIL.
- [ ] **Step 3: implement**
  - `Gpu` gets `uuid: str = ""` and `mem_temp: float | None = None` (after `procs`, before
    `detail`).
  - The parser: `len(f) in (11, 12)`; `uuid=f[11].strip()[:64] if len(f) == 12 else ""`.
    `gpu_mem_temp` is collected into a dict keyed by lower-case bus id; after the loop, for v2,
    set `g.mem_temp = t if t is not None and -50 <= t <= 200 else None`.
  - `_GPU_FLOATS` gains `"mem_temp"`; the string check covers `uuid`.
- [ ] **Step 4:** run `pytest -q tests/test_homelab_probe.py tests/test_homelab_rules.py`. Expected: PASS.
- [ ] **Step 5:** commit `feat(gpus): parse card UUID and memory temperature`.

### Task 3: Rules (`rules.py`)

**Interfaces:** produces `gpu_state(g, thr, outcome, throttled=None)`,
`gpu_condition(g, thr, throttled=None, fast=False)` and
`IssueTracker.raised(host, key) -> Condition | None`.

- [ ] **Step 1: failing tests** (`tests/test_homelab_rules.py`):
  - `gpu_state(g(throttle=0), thr, "ok", throttled=True) == "throttling"`;
  - `throttled=False` with throttle 0x20 → `busy`;
  - `None` → the old rule;
  - heat still wins over `throttled=True`;
  - `gpu_condition(cool, thr, throttled=True, fast=True)` → warn `GPU 0 throttling`, hold 1;
  - hot plus `fast=True` → the heat title with hold 1;
  - hot with `fast=False` → hold `HOLD_TEMP`;
  - `throttled=False` with mask 0x20 → None when cool;
  - the default keeps the old behaviour (mask 0x20 → throttling, `HOLD_TEMP`);
  - `IssueTracker.raised` is None before the hold is reached, the condition once raised, and
    None after clearing.
- [ ] **Step 2:** run. Expected: FAIL.
- [ ] **Step 3: implement.** In `gpu_state`: `thr_now = throttling(g) if throttled is None else throttled`.
  In `gpu_condition`: the same, and `hold = 1 if fast else HOLD_TEMP` for both branches.
  `raised()`: `t = self._t.get((host, key)); return t.cond if t and t.raised else None`.
- [ ] **Step 4:** run. Expected: PASS.
- [ ] **Step 5:** commit `feat(gpus): rules take a smoothed throttle value and a fast hold`.

### Task 4: Poller (`poller.py`)

**Interfaces:** consumes Task 3. Internal: `self._thr: dict[tuple[str, int], _ThrHist]`, where
`_ThrHist` holds `ident: str`, `readings: deque[(float, bool)]` (maxlen 4) and
`unresolved: bool`.

- [ ] **Step 1: failing tests** (`tests/test_homelab_collector.py`, using `gmake`, plus a fake
  `mono` where age matters):
  - each §6.3 trace, as written, with exact row states and issue presence per poll:
    - alternating;
    - `1,1,1`;
    - `1,1,1,1` then zeros, with the clear on the fourth zero;
    - `1,1` then hot with slowdown, raised at poll 3 with the heat title;
    - hot ×4, then cool `1,0,1,0`, staying until the row stops THROTTLING plus 2;
    - the legacy title changes (two traces);
    - interrupted recovery;
    - offline in the middle freezing recovery;
  - expiry: `1,1` at mono 0 and 30, then a reading at mono `4×cycle + 31` with `1`: no issue,
    and the row is THROTTLING only from its own sample;
  - a wall clock that jumps back does not extend the age (mono decides);
  - identity: a UUID change at index 0 resets (`1,1` from A, then `1` from B → no issue);
    with no UUID, a bus id change resets; with neither, a name change resets;
  - a missing index drops; `none` drops; unreadable leaves the history alone;
  - `test_throttle_mask_lost_keeps_throttling_alert` is updated to the new expected trace (the
    clear comes after 4 zeros, because of recency). This is the only change to an existing
    test's expectation, and §6.3 says why.
- [ ] **Step 2:** run. Expected: FAIL.
- [ ] **Step 3: implement**
  - `_cycle()` = `1.1 * poll_seconds + ceil(len(hosts) / 8) * 40`; `_age_limit = 4 * _cycle()`.
  - In `poll_once`, take `mono_now = self._mono()` at the start and pass it to `_take_gpus`.
  - `_take_gpus` for `ok`/`legacy`:
    - drop entries for indices not in the sample, or for every index on `none`;
    - per GPU (v2 `ok` only): compute the identity; if it differs from the stored one, reset
      the history and `unresolved`; if `g.throttle is not None`, append
      `(mono_now, throttling(g))`;
    - legacy: clear the readings, keeping `unresolved`.
  - Then build the conditions: `conds = [c for c in conds if not c.key.startswith("gpu_temp:")]`;
    per GPU:
    - `live` = readings newer than `mono_now − age`;
    - `recent` and `qualifies` from `live` (None when `live` is empty);
    - `raised = self._tracker.raised(host, key)`;
    - `can_show = (outcome == "ok" and g.throttle is not None)`;
    - if `unresolved and not can_show`: `throttled = fast = True`;
    - elif legacy: `throttled, fast = False, False`;
    - else `throttled = bool(qualifies) or (raised is not None and bool(recent))`, `fast = throttled`;
    - `c = gpu_condition(g, thr, throttled, fast)`.

    Keep-keys as before, except that a legacy GPU is no longer kept by the old legacy rule;
    the unresolved flag covers it. `gpu_keep_keys` is unchanged for v2.
  - After `self._tracker.update(...)`: for each GPU of this host, if
    `throttled and self._tracker.raised(host, key)`, set `unresolved`; if the tracker no longer
    holds the key, clear it. Add `IssueTracker.holds(host, key) -> bool` (any track, raised
    or not) for this.
  - `_gpu_rows` passes `recent` (or None) to `gpu_state`, computed with the last poll's
    `mono_now`.
- [ ] **Step 4:** run `pytest -q tests/test_homelab_collector.py tests/test_homelab_rules.py`.
  Expected: PASS.
- [ ] **Step 5:** commit `feat(gpus): judge throttling over recent polls, keep unresolved throttling`.

### Task 5: Snapshot and screen

- [ ] **Step 1: failing tests:**
  - `test_gpu_rows_and_order` gets `mem_temp` in its row keys.
  - Harness fixtures:
    - `GPU_HOUSE` rows get `mem_temp` (84, plus one None);
    - `GPU_HOUSE_HOSTILE` gets `mem_temp: '<b>9</b>'`;
    - a new `GPU_HOUSE_MEM_EDGE` has 1e9, −80, NaN, 199.6 and −49.6.
  - Harness checks:
    - the full layout shows `MEM 84°` for the row with 84;
    - no `MEM` for None, out-of-range values or a string;
    - `MEM 200°` for 199.6;
    - `MEM -50°` for −49.6;
    - the strip layout has no `MEM`.
- [ ] **Step 2:** run `node tests/js/render_harness.js`. Expected: FAIL.
- [ ] **Step 3: implement**
  - `_row` adds `"mem_temp": g.mem_temp`.
  - In `bsGpuRow`, when not compact:
    `const mt = gpuFin(r.mem_temp); const memOk = mt !== null && mt >= -50 && mt <= 200;`
  - The temp cell becomes `<div>${core}</div>` + (memOk ?
    `<div style="color:${S.therm(mt)};font-size:${gq(11)};letter-spacing:0.04em">MEM ${Math.round(mt)}&deg;</div>` : '').
  - Check that `gpuFin` rejects strings; if not, use `typeof r.mem_temp === 'number'`.
- [ ] **Step 4:** run the harness, `./scripts/check_js.sh`, and fit_check with
  `CASES=gpus:GPU_HOUSE,gpus:GPU_HOUSE_MEM_EDGE SHAPES=1800x1200,1920x462,1024x600 TABS=2,5,7`.
  Expected: OK.
- [ ] **Step 5:** commit `feat(gpus): memory temperature under the core temperature`.

### Task 6: Docs and gate

- [ ] **Step 1:** update:
  - README's GPUs section (memory temperature; throttling over recent polls);
  - CHANGELOG;
  - the CLAUDE.md Home Lab paragraph (one sentence on the throttle history);
  - regenerate the site (`gen_site_assets.py`).
- [ ] **Step 2: the gate:**
  - the full pytest;
  - the harness;
  - check_js;
  - ruff on the changed files;
  - shellcheck;
  - devices_check;
  - fit_check at 2/5/7 tabs on 3 shapes.
- [ ] **Step 3:** commit `docs: GPUs amendment`.
- [ ] **Step 4:** run the probe by hand on the real GPU host again (read-only, `sh -s`) and parse
  its output: 12 fields, a UUID, and `mem_temp` present.

## Revisions from review (binding: each overrides the task text it names)

- **R1 (Task 1, Task 2) UUID normalization.**
  - The probe sets the UUID empty unless it matches `^(GPU|MIG)-[0-9A-Za-z-]+$` after
    stripping, so `[N/A]` becomes `""`.
  - The parser applies the same pattern.
  - Tests: an `[N/A]` UUID gives an empty field; a poller test with two cards at index 0 with
    no UUID and different bus ids resets the history.
- **R2 (Task 4) Per-GPU decisions.**
  - `_take_gpus` returns `(conds, keep, decided)`, where `decided: dict[int, bool]` maps each
    sampled index to the `throttled` value it passed for this poll.
  - `poll_once` applies the flag rule after `tracker.update`, from `decided` (never from a
    title): set `unresolved` when `decided[i]` and `tracker.raised(host, key)`; clear it when
    not `tracker.holds(host, key)`.
  - Test: two GPUs, GPU 0 `1,1,hot+1` (heat title) and GPU 1 `0,0,0`, then legacy cool samples.
    GPU 0's alert stays and GPU 1 has none.
- **R3 (Task 4) The instant rows are judged at.**
  - `poll_once` keeps its two `mono` reads: `start` (readings are stamped with it) and `end`,
    read once and used for both `published_at` and the row evaluation (`_gpu_rows(end)`).
  - `self._thr` is initialized before the constructor's `_gpu_rows(None)`; `None` means no
    history, so the sample alone decides.
  - Test: a fake mono where a reading is inside the limit at `start` but outside it at `end`,
    on a sample with a missing mask: the row is not THROTTLING.
  - `test_publication_times_and_staleness` stays unchanged.
- **R4 (Task 5/6) fit_check tab counts.** Run three separate invocations, `TABS=2`, `TABS=5`
  and `TABS=7`, each with the same shapes and cases.
- **R5 (Task 1) Isolation from the host.**
  - `_controlled_probe` gains `omit=()`: tools left out of the PATH. The timing and memory
    tests omit `systemctl`, `apt-get` and `lsblk`, so nothing slow or host-dependent runs.
  - They pass a deterministic uptime file.
  - Each test that expects the memory query asserts its args appear in ARGLOG.
  - A TERM-ignoring memory query (`trap '' TERM; sleep 30`) still ends the probe within 8 s,
    with the main sample printed.
- **R6 (Task 4) Expiry and missing-mask tests.**
  - `1` (mono 0), then a sample at mono `age + 1` with mask `0` → BUSY. The same with mask
    `None` → BUSY (the sample alone).
  - Missing masks leave the history (`1,1`, `None`, `1` → raised).
  - Interrupted recovery with a missing mask in place of a legacy sample.
- **R7 (Task 4) Helpers.**
  - `gmake(..., clock=None)` takes an explicit clock, defaulting to the 30 s iterator.
  - The `none` drop is tested by calling `_take_gpus` directly on a poller whose `_thr` was
    filled, with a report whose outcome is `none` (no remembered GPUs).
- **R8 (Task 3)** The rules tests that expect BUSY pass `util=50.0`.
- **R9 (Task 1) Uptime reads.**
  - `up()` reads only `NR == 1` and prints one integer.
  - The shell checks each value with `case $v in ''|*[!0-9]*) skip`, so arithmetic only ever
    sees one integer.
  - Test: a two-line uptime file skips the query without breaking the probe.
- **R10 (Task 4, replaces R3's timing)** One evaluation instant per poll.
  - `end = self._mono()` is read once, right after the thread pool returns and before any
    host's results are processed.
  - Readings are stamped with `start`. Expiry for both conditions and rows is judged at
    `end`, and `published_at = now + (end − start)`.
  - This is still two `mono` reads per poll.
  - Test: slowdowns at 0 and 30, then a slowed poll with `start = A − 1` and `end = A + 31`.
    No alert is raised, and its row's THROTTLING comes from its own sample. The
    missing-mask variant has a row that is not THROTTLING.
- **R11 (Task 4, replaces R6's interruption test)** The trace is
  `1,1,1,legacy,0,None,0,0`:
  - raised at 3, kept by the legacy sample;
  - good 1 at the first `0`;
  - the `None` puts the condition back (unresolved);
  - good 1 and good 2 on the last two zeros: cleared, and the flag is cleared.
- **R12 (Task 1, replaces R9's test)** Extra lines in the uptime file are ignored (only line 1
  counts). Test: a two-line file with line 1 valid runs the query, and the probe exits 0 with
  no arithmetic error.
