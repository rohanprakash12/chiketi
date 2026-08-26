# Chiketi Audit Remediation Implementation Plan

> **For agentic workers:** Each phase is implemented by one agent, then gated by an independent Fable QA agent. Do NOT proceed to the next phase until QA returns PASS. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix every defect identified in the two independent audits of chiketi, without breaking any behavior that works today.

**Architecture:** Eight phases ordered by severity and dependency. Phase 0 builds the JS regression net that every later phase depends on (two-thirds of this codebase is untested JavaScript). Phases 1–5 fix defects. Phase 6 adds persistence. Phase 7 handles website, licensing, packaging, and cleanup.

**Tech Stack:** Python 3.11+, psutil, stdlib `http.server`, vanilla browser JS (no build step), pytest, ruff, Node (test-only, optional).

**Spec:** This document. The defect list is the consolidated output of two audits, with every claim verified against the code before being included here.

---

## Global Constraints

Copy these verbatim into every task's requirements.

- **No breaking changes.** Anything that works today must still work after every phase. Specifically: `chiketi` with no arguments must still bind `0.0.0.0:7777` with no auth; the control panel must still work without a token; every existing CLI flag keeps its current meaning.
- **Python floor is 3.11.** No syntax or stdlib newer than 3.11.
- **Runtime dependencies stay at `psutil` only.** `nvidia-ml-py` stays optional under the `[nvidia]` extra. Do not add a runtime dependency for any reason.
- **No build step for the UI.** `chiketi/assets/ui/*.js` is served as-is and concatenated by `server.py`. It must remain valid standalone ES2017 that `node --check` accepts. No imports, no bundler, no TypeScript.
- **`ruff check .` must pass** after every task. Do NOT run `ruff format` — this project has never adopted it and reformatting 18 files would bury real changes in noise.
- **`pytest -q` must pass** after every task. The suite is 94 tests at plan time and only grows.
- **Never edit `docs/site/data.js`, `docs/site/dashboard.js`, or `docs/site/dashboard.css` by hand.** They are generated. Run `python scripts/gen_site_assets.py` and commit the result.
- **Tests are headless.** No test may require a display, GPU, network, or real `xrandr`/Chromium.
- **Commit after every task** with the message given in the task.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `tests/js/render_harness.js` | Node harness: loads the real renderers, runs them against metric fixtures, reports structured failures |
| `tests/js/fixtures.js` | Metric fixtures (full / empty / degenerate / large-disk) shared by the harness |
| `tests/test_renderers.py` | pytest wrapper that shells out to the harness; skips cleanly when node is absent |
| `tests/test_app.py` | Tests for `MetricEngine`, `DisplayManager`, session-env detection |
| `tests/test_cli.py` | Tests for `__main__.py` argument parsing and validation |
| `tests/test_state.py` | Tests for the persistence layer |
| `chiketi/state.py` | Load/save versioned settings under `$XDG_CONFIG_HOME/chiketi/state.json` |
| `chiketi/assets/fonts/OFL-*.txt` | Per-family SIL Open Font License text (5 missing families) |

**Heavily modified:**

| File | Change |
|---|---|
| `chiketi/assets/ui/screen_functions.js` | Unit-aware disk formatter (6 sites), dynamic backend title (6 sites), null-safety, escaping |
| `chiketi/server.py` | Body limits, CSRF/Origin, CORS scoping, security headers, state lock, brightness fix |
| `chiketi/collectors/network.py` | Per-interface counters, reset clamping, single `net_if_addrs()` call |
| `chiketi/collectors/llm.py` | HTTP-discovered status, tok/sec staleness, Ollama context mislabel |
| `chiketi/collectors/claude.py` | Partial-line preservation, truncation detection, rate reset |

---

## Phase Sequencing

```
Phase 0  Test net            <- everything depends on this
Phase 1  Critical defects    <- disk corruption, CPU peg
Phase 2  Server hardening
Phase 3  Collector accuracy
Phase 4  Renderer/UI
Phase 5  Runtime robustness
Phase 6  Persistence
Phase 7  Site / licence / packaging / cleanup
```

Each phase: **implement -> commit -> Fable QA gate -> proceed only on PASS.**

---

# Phase 0: Test Net

**Why first:** Every later phase edits JavaScript that has zero automated coverage. Without this harness, QA on phases 1 and 4 is manual inspection, which is exactly how the disk bug survived the last review.

### Task 0.1: Node render harness

**Files:**
- Create: `tests/js/fixtures.js`
- Create: `tests/js/render_harness.js`
- Create: `tests/test_renderers.py`

**Interfaces:**
- Produces: `render_harness.js` exits 0 on success, non-zero on failure, and prints one `FAIL <fixture> <theme> <screen>: <reason>` line per problem. Later phases add fixtures and assertions to these files.

**Critical context for the implementer:** `chiketi/assets/ui/screen_functions.js` is NOT a module. It defines bare top-level functions and depends on globals that `display_app.js` supplies: `PANEL_SPEC`, `esc`, `tBar`, `tPanel`, `tRow`, `lPanel`, `lStat`, `lBar`, `GOLD`, `AMBER`, `GREEN`, `TEAL`, `_thermColor`, `m`, `mv`, `cleanModel`. The harness must define `m`/`mv`/`cleanModel` itself (copy them verbatim from `display_app.js`), then load `shared_helpers.js` and `screen_functions.js` via `eval` in a scope where `PANEL_SPEC` is already bound. `shared_helpers.js` reads `PANEL_SPEC` at load time, so bind it first or loading throws.

Real metric key names, confirmed against the collectors — **do not guess these**:

```
sys.hostname sys.uptime
cpu.usage cpu.per_core cpu.temp cpu.mb_temp cpu.fan cpu.fan_count cpu.fans_cpu cpu.fans_case
mem.ram_used mem.ram_total mem.ram_percent mem.swap_used mem.swap_total mem.swap_percent
disk.root_used disk.root_total disk.root_percent disk.home_used disk.home_total disk.home_percent
net.ip net.mac net.speed net.dl net.ul
gpu.name gpu.temp gpu.fan gpu.power gpu.vram_used gpu.vram_total gpu.vram_percent
gpu.util gpu.mem_util gpu.clock_gpu gpu.clock_mem gpu.processes
llama.status llama.backend llama.health llama.model llama.quant llama.context
llama.active_slots llama.tok_per_sec llama.processes
claude.tokens_input claude.tokens_output claude.tokens_cache_write claude.tokens_cache_read
claude.tokens_total claude.msgs_user claude.msgs_assistant claude.msgs_total
claude.monthly_tokens claude.monthly_messages claude.days_active claude.sessions
claude.session_input claude.session_output claude.session_cache_write claude.session_cache_read
claude.session_total claude.session_msgs claude.agents_active claude.token_rate claude.sparkline
```

Note `disk.root_*` not `disk._*` — the collector computes `"/".replace("/","_").strip("_") or "root"`.

- [ ] **Step 1: Write `tests/js/fixtures.js`**

Export four fixtures. Each is a `{key: {value, unit, available, extra}}` map matching the `/api/metrics` shape.

```js
// tests/js/fixtures.js
'use strict';
function mval(value, unit, extra) {
  return { value: value, unit: unit || '', available: true, extra: extra || {} };
}

// Every metric present and plausible. Disk under 1 TiB so the collector
// would have emitted GiB.
const FULL = {
  'sys.hostname': mval('chiketi-pi'),
  'sys.uptime': mval('3d 4h 12m', '', { seconds: 274320 }),
  'cpu.usage': mval(42.5, '%'),
  'cpu.per_core': mval([10, 20, 30, 40, 50, 60, 70, 80], '%'),
  'cpu.temp': mval(61, '°C'),
  'cpu.mb_temp': mval(38, '°C'),
  'cpu.fan': mval(1200, 'RPM'),
  'cpu.fan_count': mval(4),
  'cpu.fans_cpu': mval([1200, 1300], '', { count: 2 }),
  'cpu.fans_case': mval([800, 900], '', { count: 2 }),
  'mem.ram_used': mval(12.3, 'GiB', { total: 31.2, percent: 39.4 }),
  'mem.ram_total': mval(31.2, 'GiB'),
  'mem.ram_percent': mval(39.4, '%'),
  'mem.swap_used': mval(0.5, 'GiB', { total: 8.0, percent: 6.3 }),
  'mem.swap_total': mval(8.0, 'GiB'),
  'mem.swap_percent': mval(6.3, '%'),
  'disk.root_used': mval(120.5, 'GiB', { total: 500.0, percent: 24.1 }),
  'disk.root_total': mval(500.0, 'GiB'),
  'disk.root_percent': mval(24.1, '%'),
  'disk.home_used': mval(300.0, 'GiB', { total: 900.0, percent: 33.3 }),
  'disk.home_total': mval(900.0, 'GiB'),
  'disk.home_percent': mval(33.3, '%'),
  'net.ip': mval('192.168.16.66'),
  'net.mac': mval('AA:BB:CC:DD:EE:FF'),
  'net.speed': mval(1000, 'Mbps'),
  'net.dl': mval(12.4, 'MB/s', { raw_bytes_per_sec: 12400000 }),
  'net.ul': mval(1.1, 'MB/s', { raw_bytes_per_sec: 1100000 }),
  'gpu.name': mval('NVIDIA GeForce RTX 4090'),
  'gpu.temp': mval(65, '°C'),
  'gpu.fan': mval(45, '%'),
  'gpu.power': mval(220, 'W', { limit: 450 }),
  'gpu.vram_used': mval(8192, 'MiB', { total: 24576, percent: 33.3 }),
  'gpu.vram_total': mval(24576, 'MiB'),
  'gpu.vram_percent': mval(33.3, '%'),
  'gpu.util': mval(72, '%'),
  'gpu.mem_util': mval(40, '%'),
  'gpu.clock_gpu': mval(2400, 'MHz', { max: 2600 }),
  'gpu.clock_mem': mval(10500, 'MHz', { max: 10501 }),
  'gpu.processes': mval([{ pid: 1234, name: 'llama-server', vram_mib: 7000 }]),
  'llama.status': mval('Running'),
  'llama.backend': mval('llama.cpp'),
  'llama.health': mval('ok'),
  'llama.model': mval('Qwen2.5-32B-Instruct-Q4_K_M.gguf'),
  'llama.quant': mval('Q4_K_M'),
  'llama.context': mval(32768),
  'llama.active_slots': mval(1, '', { total: 4 }),
  'llama.tok_per_sec': mval(38.2, 't/s'),
  'llama.processes': mval([{ pid: 1234, model: 'Qwen2.5-32B-Instruct-Q4_K_M.gguf' }], '', { count: 1 }),
  'claude.tokens_input': mval(1200000),
  'claude.tokens_output': mval(340000),
  'claude.tokens_cache_write': mval(900000),
  'claude.tokens_cache_read': mval(48000000),
  'claude.tokens_total': mval(50440000),
  'claude.msgs_user': mval(4200),
  'claude.msgs_assistant': mval(5100),
  'claude.msgs_total': mval(9300),
  'claude.monthly_tokens': mval(12000000),
  'claude.monthly_messages': mval(2300),
  'claude.days_active': mval(126),
  'claude.sessions': mval(480),
  'claude.session_input': mval(12000),
  'claude.session_output': mval(3400),
  'claude.session_cache_write': mval(9000),
  'claude.session_cache_read': mval(480000),
  'claude.session_total': mval(504400),
  'claude.session_msgs': mval(42),
  'claude.agents_active': mval(3),
  'claude.token_rate': mval(18000, 'tok/min'),
  'claude.sparkline': mval([100, 500, 2000, 18000, 4000, 900, 12000, 300, 50, 7000]),
};

// Nothing collected yet: every m() lookup misses.
const EMPTY = {};

// Every metric flagged unavailable (collector caught an exception).
const UNAVAILABLE = (function () {
  const o = {};
  for (const k of Object.keys(FULL)) {
    o[k] = { value: null, unit: FULL[k].unit, available: false, extra: {} };
  }
  return o;
})();

// available:true with a null value. No collector emits this today, but a
// renderer must not throw on it -- this fixture is what keeps that true.
const NULL_VALUES = (function () {
  const o = {};
  for (const k of Object.keys(FULL)) {
    o[k] = { value: null, unit: FULL[k].unit, available: true, extra: {} };
  }
  return o;
})();

// Disks at/over 1 TiB: the collector switches to TiB units here.
// This fixture is what proves the disk formatter bug is fixed.
const LARGE_DISK = (function () {
  const o = Object.assign({}, FULL);
  o['disk.root_used'] = mval(1.5, 'TiB', { total: 2.0, percent: 75.0 });
  o['disk.root_total'] = mval(2.0, 'TiB');
  o['disk.root_percent'] = mval(75.0, '%');
  o['disk.home_used'] = mval(1.2, 'TiB', { total: 4.0, percent: 30.0 });
  o['disk.home_total'] = mval(4.0, 'TiB');
  o['disk.home_percent'] = mval(30.0, '%');
  return o;
})();

// Hostile strings in every string-valued metric.
const HOSTILE = (function () {
  const o = {};
  for (const k of Object.keys(FULL)) {
    const v = FULL[k];
    o[k] = typeof v.value === 'string'
      ? { value: '<img src=x onerror=alert(1)>', unit: v.unit, available: true, extra: v.extra }
      : v;
  }
  return o;
})();

module.exports = { FULL, EMPTY, UNAVAILABLE, NULL_VALUES, LARGE_DISK, HOSTILE };
```

- [ ] **Step 2: Write `tests/js/render_harness.js`**

It must render every (fixture x theme x screen) combination and assert:
1. No exception thrown.
2. Returns a string longer than 100 chars.
3. Output contains no `undefined`, `NaN`, or `[object Object]`.
4. For `HOSTILE`, output contains no `onerror=` (everything must be escaped).

Get the theme palettes and `PANEL_SPEC` by invoking Python — do not duplicate them:

```js
// tests/js/render_harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const FIX = require('./fixtures.js');

const ROOT = path.resolve(__dirname, '..', '..');
const UI = path.join(ROOT, 'chiketi', 'assets', 'ui');

// Pull the real spec + palettes from the product, so the harness can never
// drift from themes.py / panel_spec.py.
const PY = process.env.CHIKETI_PYTHON || 'python3';
const blob = JSON.parse(execFileSync(PY, ['-c', [
  'import json, sys',
  'sys.path.insert(0, ' + JSON.stringify(ROOT) + ')',
  'from chiketi.panel_spec import web_spec',
  'from chiketi.themes import get_families',
  'F=("primary","accent","background","panel","border","header","dim","critical")',
  'fam={f:{t.name:{k:getattr(t,k) for k in F} for t in ts} for f,ts in get_families().items()}',
  'print(json.dumps({"spec":web_spec(),"families":fam}))',
].join('\n')], { encoding: 'utf8', cwd: ROOT }));

const PANEL_SPEC = blob.spec;
const FAMILIES = blob.families;

let metrics = FIX.FULL;

// Copied verbatim from display_app.js. If display_app.js changes these,
// change them here too.
function m(key) {
  if (!metrics || !metrics[key]) return { value: null, available: false, unit: '', extra: {} };
  return metrics[key];
}
function mv(key, suffix) {
  const d = m(key);
  if (!d.available) return 'N/A';
  return esc(suffix ? d.value + suffix : String(d.value));
}
function cleanModel() {
  const d = m('llama.model');
  if (!d.available) return '--';
  return esc(String(d.value).replace(/\.gguf$/i, '').replace(/[-_]Q\d[A-Z0-9_]*$/i, '').replace(/_/g, ' ').replace(/-$/, ''));
}

// shared_helpers.js reads PANEL_SPEC at load time, so it must already be bound.
eval(fs.readFileSync(path.join(UI, 'shared_helpers.js'), 'utf8'));
eval(fs.readFileSync(path.join(UI, 'screen_functions.js'), 'utf8'));

// Mirrors getScreenRegistry() in display_app.js.
const REGISTRY = [
  { family: 'Panel', variant: 'Gold', fns: [panelGoldScreen1, panelGoldScreen2] },
  { family: 'Panel', variant: 'Coral', fns: [panelCoralScreen1, panelCoralScreen2] },
  { family: 'Panel', variant: 'Teal', fns: [panelTealScreen1, panelTealScreen2] },
  { family: 'Vintage', variant: 'Scanlines', fns: [scanScreen1, scanScreen2] },
  { family: 'Vintage', variant: 'Tubes', fns: [tubeScreen1, tubeScreen2] },
  { family: 'Vintage', variant: 'VFD', fns: [vfdScreen1, vfdScreen2] },
  { family: 'Terminal', variant: 'hacker', fns: [terminalScreen1, terminalScreen2] },
];

const failures = [];
function fail(fixture, label, reason) {
  failures.push('FAIL ' + fixture + ' ' + label + ': ' + reason);
}

for (const fixtureName of Object.keys(FIX)) {
  metrics = FIX[fixtureName];
  for (const entry of REGISTRY) {
    const colors = FAMILIES[entry.family][entry.variant];
    const fns = entry.fns.concat([claudeScreen3]);
    fns.forEach(function (fn, i) {
      const label = entry.family + '/' + entry.variant + ' screen' + (i + 1) + ' (' + fn.name + ')';
      let html;
      try {
        html = fn(colors);
      } catch (e) {
        fail(fixtureName, label, 'threw ' + e.message);
        return;
      }
      if (typeof html !== 'string' || html.length < 100) {
        fail(fixtureName, label, 'returned ' + (html && html.length) + ' chars');
        return;
      }
      const dirty = html.match(/undefined|NaN|\[object Object\]/);
      if (dirty) fail(fixtureName, label, 'output contains ' + dirty[0]);
      if (fixtureName === 'HOSTILE' && html.indexOf('onerror=') !== -1) {
        fail(fixtureName, label, 'unescaped metric reached output');
      }
    });
  }
}

if (failures.length) {
  failures.forEach(function (f) { console.error(f); });
  console.error('\n' + failures.length + ' renderer failures');
  process.exit(1);
}
console.log('renderer harness OK');
```

- [ ] **Step 3: Run the harness and record the baseline**

```bash
node tests/js/render_harness.js
```

Expected: **FAILS.** `NULL_VALUES` will throw on `cpu.fans_cpu` (`.length` of null) and six `claude.*` keys (`.toLocaleString` of null). `HOSTILE` will report unescaped output for `net.ip`, `net.mac`, `llama.health`. `LARGE_DISK` will NOT fail here — `0.0T` contains no forbidden token. That is expected; Phase 1 adds the assertion that catches it.

Write the exact failure list into the commit message. These are the Phase 4 acceptance criteria.

- [ ] **Step 4: Write `tests/test_renderers.py`**

```python
"""Runs the Node renderer harness. Skipped when node is unavailable."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

HARNESS = Path(__file__).parent / "js" / "render_harness.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None,
    reason="node not installed; renderer harness cannot run",
)


def test_all_renderers_produce_clean_output():
    result = subprocess.run(
        ["node", str(HARNESS)],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, (
        "renderer harness failed:\n" + result.stdout + result.stderr
    )
```

- [ ] **Step 5: Mark the known failures xfail so the suite stays green**

Until Phase 4 fixes them, `test_all_renderers_produce_clean_output` fails. Do NOT leave the suite red. Add an env-gated allowlist to the harness: when `CHIKETI_HARNESS_ALLOW` is set to a comma-separated list of fixture names, failures from those fixtures are printed as warnings and do not affect the exit code.

In the harness, replace the final block with:

```js
const allow = (process.env.CHIKETI_HARNESS_ALLOW || '').split(',').filter(Boolean);
const blocking = failures.filter(function (f) {
  return !allow.some(function (a) { return f.indexOf('FAIL ' + a + ' ') === 0; });
});
failures.forEach(function (f) { console.error(f); });
if (blocking.length) {
  console.error('\n' + blocking.length + ' blocking renderer failures');
  process.exit(1);
}
console.log('renderer harness OK (' + (failures.length - blocking.length) + ' allowed failures)');
```

And in `tests/test_renderers.py`, pass the allowlist:

```python
    result = subprocess.run(
        ["node", str(HARNESS)],
        capture_output=True,
        text=True,
        timeout=120,
        env={**os.environ, "CHIKETI_HARNESS_ALLOW": "NULL_VALUES,HOSTILE"},
    )
```

Add `import os` at the top. **Phase 4 removes this allowlist entirely** — that is Phase 4's acceptance test.

- [ ] **Step 6: Verify**

```bash
pytest -q && ruff check .
```
Expected: all tests pass (95+), lint clean.

- [ ] **Step 7: Commit**

```bash
git add tests/js tests/test_renderers.py
git commit -m "test: add Node renderer harness covering all theme/screen/fixture combinations

Documents the current renderer failures (NULL_VALUES, HOSTILE) behind an
allowlist; Phase 4 removes it."
```

### Task 0.2: Fix sdist test packaging

**Files:**
- Modify: `pyproject.toml`

**Problem:** The sdist ships `tests/test_*.py` but omits `tests/conftest.py`, `tests/__init__.py`, and `tests/fixtures/session.jsonl`. The shipped suite cannot run — `restore_theme_listeners` and `restore_active_theme` are undefined.

**Decision:** exclude tests from release artifacts entirely. They are a development concern; the repo is the place to run them.

- [ ] **Step 1: Add sdist exclusion to `pyproject.toml`**

```toml
[tool.setuptools.exclude-package-data]
"*" = ["tests", "tests.*"]
```

That alone is insufficient — setuptools auto-includes top-level `tests/` in sdists. Add a `MANIFEST.in`:

- [ ] **Step 2: Create `MANIFEST.in`**

```
prune tests
prune plans
prune specs
prune ui_ideas
prune docs
exclude setup.py
```

- [ ] **Step 3: Verify both artifacts**

```bash
python -m build -o /tmp/chiketi-dist
tar tzf /tmp/chiketi-dist/*.tar.gz | grep -E 'tests/|docs/' && echo "LEAK" || echo "clean"
unzip -l /tmp/chiketi-dist/*.whl | grep -c 'assets/ui/'
```
Expected: `clean`, and `9` UI asset files still present in the wheel. **The wheel must not lose `assets/ui/` — that would break the installed product.** If the count is not 9, stop and fix.

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml MANIFEST.in
git commit -m "build: exclude tests/docs from sdist; keep UI assets in wheel"
```

---

## GATE 0 -> Fable QA

Dispatch QA with the Phase 0 brief. **Do not start Phase 1 until PASS.**

---

# Phase 1: Critical Defects

Two bugs: one corrupts visible output on common hardware, one pegs the CPU.

### Task 1.1: Unit-aware disk capacity formatter

**Files:**
- Modify: `chiketi/assets/ui/shared_helpers.js` (add formatter)
- Modify: `chiketi/assets/ui/screen_functions.js` lines 258, 381, 514, 698, 996, 1252
- Modify: `tests/js/render_harness.js` (add the assertion that proves it)

**The bug:** `disk.py:31` emits TiB when the disk is >= 1 TiB and GiB otherwise, setting `.unit` accordingly. Every renderer ignores `.unit` and hardcodes `value/1000` + `'T'`. A 4 TiB `/home` renders as `0.0T / 0.0T`. A 900 GiB disk renders as `0.9T`, which is coincidentally near-right and is why this survived.

**Interfaces:**
- Produces: `fmtCapacity(metricValue, key)` in `shared_helpers.js`, available to all renderers.

- [ ] **Step 1: Add the failing assertion to the harness first**

In `render_harness.js`, after the existing checks inside the `fns.forEach` body:

```js
      // A >=1 TiB disk must never render as 0.0. The collector emits TiB
      // units at that size; a renderer that assumes GiB produces "0.0T".
      if (fixtureName === 'LARGE_DISK' && /(^|[^\d])0\.0\s*T/.test(html)) {
        fail(fixtureName, label, 'TiB-unit disk rendered as 0.0T');
      }
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
node tests/js/render_harness.js
```
Expected: `FAIL LARGE_DISK Panel/Gold screen1 ...: TiB-unit disk rendered as 0.0T` and the same for Coral, Teal, Scanlines, Tubes, VFD. Terminal screens use a different disk layout — if Terminal does not fail, that is fine.

- [ ] **Step 3: Add `fmtCapacity` to `shared_helpers.js`**

Append to the end of the file:

```js
/* Format a disk capacity metric for display, honouring the unit the collector
   chose. disk.py emits TiB for volumes >= 1 TiB and GiB below that, so a
   renderer that assumes one or the other is wrong half the time.
   Returns e.g. "1.2T", "300G", or "?" when unavailable. */
function fmtCapacity(d) {
  if (!d || !d.available || d.value == null || isNaN(d.value)) return '?';
  const unit = String(d.unit || 'GiB');
  let tib;
  if (unit === 'TiB') tib = Number(d.value);
  else if (unit === 'MiB') tib = Number(d.value) / (1024 * 1024);
  else tib = Number(d.value) / 1024;          // GiB, the collector's default
  if (tib >= 1) return tib.toFixed(1) + 'T';
  const gib = tib * 1024;
  if (gib >= 1) return Math.round(gib) + 'G';
  return Math.round(gib * 1024) + 'M';
}

/* Same, for the `extra.total` companion field, which carries no unit of its
   own -- it is always in the same unit as its parent metric. */
function fmtCapacityTotal(d) {
  if (!d || !d.available || !d.extra || d.extra.total == null) return '?';
  return fmtCapacity({ available: true, value: d.extra.total, unit: d.unit });
}
```

- [ ] **Step 4: Replace all six renderer sites**

Each site currently reads (template-literal form, lines 258/381/514):

```js
${diskHome.value?(diskHome.value/1000).toFixed(1):'?'}T / ${diskHome.extra.total?(diskHome.extra.total/1000).toFixed(1):'?'}T
```

Replace with:

```js
${fmtCapacity(diskHome)} / ${fmtCapacityTotal(diskHome)}
```

And (string-concatenation form, lines 698/996/1252):

```js
(diskHome.value?(diskHome.value/1000).toFixed(1):'?') + 'T / ' + (diskHome.extra.total?(diskHome.extra.total/1000).toFixed(1):'?') + 'T'
```

Replace with:

```js
fmtCapacity(diskHome) + ' / ' + fmtCapacityTotal(diskHome)
```

Line 1252 uses `'T/'` with no spaces — preserve that spacing: `fmtCapacity(diskHome) + '/' + fmtCapacityTotal(diskHome)`.

**Do not touch lines 236, 333, 659, 960, 1210.** Those are `netSpeed.value/1000` converting Mbps to Gbps, which is correct — network link speed is decimal.

Also check the PRIMARY disk display adjacent to each SECONDARY site. If it uses `disk.root_*` with a hardcoded unit, apply the same formatter. Inspect each of the six regions.

- [ ] **Step 5: Verify**

```bash
node tests/js/render_harness.js && pytest -q && ruff check .
```
Expected: harness OK, all tests pass.

- [ ] **Step 6: Manually confirm the original symptom is gone**

```bash
node -e '
process.env.CHIKETI_HARNESS_ALLOW="NULL_VALUES,HOSTILE";
' ; node - <<'EOF'
// quick visual check
const path=require("path");
process.chdir(path.resolve("."));
EOF
```
Simpler: add a temporary print in the harness for `LARGE_DISK` + `Panel/Gold`, confirm it shows `1.2T / 4.0T`, then remove the print. Record the before/after strings in the commit message.

- [ ] **Step 7: Regenerate site assets and commit**

```bash
python scripts/gen_site_assets.py
git add chiketi/assets/ui/shared_helpers.js chiketi/assets/ui/screen_functions.js tests/js/render_harness.js docs/site/
git commit -m "fix(ui): honour collector disk units; >=1TiB volumes rendered as 0.0T

disk.py emits TiB above 1 TiB and GiB below; all six renderers hardcoded
value/1000 + 'T'. A 4 TiB /home displayed as '0.0T / 0.0T'."
```

### Task 1.2: Validate `--rotate-interval`

**Files:**
- Modify: `chiketi/__main__.py`
- Modify: `chiketi/assets/ui/display_app.js`
- Create: `tests/test_cli.py`

**The bug:** `--rotate-interval 0` sets `TIMING.rotate_interval_s = 0`. That flows to `/api/display` as `default_duration: 0`, which passes the `typeof === 'number'` guard in `display_app.js`, making `durationMs` 0, making `setTimeout(onRotate, 0)` reschedule itself forever — each iteration re-rendering ~130 KB of `innerHTML`. Negative values behave the same. The POST API already clamps to 3–600; the CLI does not.

**Fix both ends:** reject at the CLI (clear error) and clamp in the browser (defense in depth, since `default_duration` also comes from a server the page trusts).

- [ ] **Step 1: Write the failing CLI test**

```python
"""Tests for the chiketi CLI entry point."""

from __future__ import annotations

import pytest

from chiketi.__main__ import build_parser, validate_args


class TestRotateInterval:
    @pytest.mark.parametrize("value", [3, 10, 600])
    def test_accepts_in_range(self, value):
        args = build_parser().parse_args(["--rotate-interval", str(value)])
        validate_args(args)  # must not raise

    @pytest.mark.parametrize("value", [0, -1, 2, 601, 100000])
    def test_rejects_out_of_range(self, value):
        args = build_parser().parse_args(["--rotate-interval", str(value)])
        with pytest.raises(SystemExit) as exc:
            validate_args(args)
        assert exc.value.code == 2

    def test_none_is_allowed(self):
        args = build_parser().parse_args([])
        assert args.rotate_interval is None
        validate_args(args)
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
pytest tests/test_cli.py -q
```
Expected: `ImportError: cannot import name 'build_parser'`.

- [ ] **Step 3: Refactor `__main__.py` to expose `build_parser` and `validate_args`**

Split the existing `main()` so the parser and validation are importable. Keep `main()`'s behavior identical.

```python
ROTATE_MIN_S = 3
ROTATE_MAX_S = 600


def build_parser() -> argparse.ArgumentParser:
    """Construct the CLI parser. Split out so tests can exercise it."""
    parser = argparse.ArgumentParser(
        prog="chiketi",
        description="System stats dashboard for 7\" GeeekPi display",
    )
    parser.add_argument(
        "--rotate-interval",
        type=int,
        default=None,
        help=f"Seconds between auto-rotation, {ROTATE_MIN_S}-{ROTATE_MAX_S} (default: 10)",
    )
    # ... the --theme, --bind, --token arguments unchanged ...
    return parser


def validate_args(args: argparse.Namespace) -> None:
    """Reject out-of-range values. Exits with status 2, like argparse errors."""
    if args.rotate_interval is not None and not (
        ROTATE_MIN_S <= args.rotate_interval <= ROTATE_MAX_S
    ):
        print(
            f"chiketi: --rotate-interval must be between {ROTATE_MIN_S} and "
            f"{ROTATE_MAX_S} seconds (got {args.rotate_interval})",
            file=sys.stderr,
        )
        raise SystemExit(2)
```

`main()` becomes:

```python
def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    validate_args(args)
    # ... rest unchanged ...
```

- [ ] **Step 4: Run the test, confirm it passes**

```bash
pytest tests/test_cli.py -q
```

- [ ] **Step 5: Clamp in the browser too**

In `display_app.js`, replace:

```js
    if (typeof displayData.default_duration === 'number') defaultDuration = displayData.default_duration;
```

with:

```js
    // Clamp: a 0/negative duration turns scheduleRotate() into a hot
    // setTimeout(0) loop that re-renders the whole screen continuously.
    if (typeof displayData.default_duration === 'number' && isFinite(displayData.default_duration)) {
      defaultDuration = Math.max(3, Math.min(600, displayData.default_duration));
    }
```

And harden `scheduleRotate()` itself:

```js
function scheduleRotate() {
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  if (enabledScreens.length <= 1) return;
  const raw = (enabledScreens[currentScreenIdx] || {}).duration || defaultDuration;
  const durationMs = Math.max(3, Math.min(600, Number(raw) || 10)) * 1000;
  const target = Math.max(lastRotate + durationMs, pauseUntil);
  rotateTimer = setTimeout(onRotate, Math.max(0, target - Date.now()));
}
```

Also clamp `duration` in `buildEnabledScreens()`, where per-screen config arrives from the server.

- [ ] **Step 6: Verify the loop is gone**

```bash
./scripts/check_js.sh          # NOT `node --check` directly -- see below
pytest -q && ruff check .
```

> `display_app.js` and `control_app.js` are wrapped in `<script>` tags (display_app.js
> has two blocks) because `server.py` inlines them into HTML. `node --check` fails on
> those tags for reasons unrelated to your change. `scripts/check_js.sh` strips the
> tags and checks all four UI files. Use it everywhere this plan says to syntax-check JS.

Then confirm the guard by direct reasoning in the commit message: with `raw = 0`, `Number(0) || 10` yields `10`, clamped to `10`, so `durationMs` is `10000`, not `0`.

- [ ] **Step 7: Regenerate site assets and commit**

```bash
python scripts/gen_site_assets.py
git add chiketi/__main__.py chiketi/assets/ui/display_app.js tests/test_cli.py docs/site/
git commit -m "fix: reject out-of-range --rotate-interval; clamp rotation duration in browser

--rotate-interval 0 produced setTimeout(onRotate, 0) rescheduling itself
forever, re-rendering ~130KB of innerHTML each iteration."
```

---

## GATE 1 -> Fable QA

---

# Phase 2: Server Hardening

Posture decision (from the user): **keep today's defaults.** `0.0.0.0` and no-auth stay. Fix the actual defects only. Nothing that works today may stop working.

### Task 2.1: Bound request bodies

**Files:**
- Modify: `chiketi/server.py`
- Modify: `tests/test_server.py`

**The bug:** `server.py:271` does `length = int(self.headers.get("Content-Length", 0))` then `self.rfile.read(length)` with no ceiling and no negative check. A negative value makes `read(-1)` block until EOF, holding a request thread. A huge value invites a large allocation.

- [ ] **Step 1: Write failing tests** in `tests/test_server.py`

```python
class TestBodyLimits:
    def test_oversized_body_rejected(self, live_server):
        req = urllib.request.Request(
            live_server + "/api/display",
            data=b"{}",
            method="POST",
            headers={"Content-Length": str(10 * 1024 * 1024)},
        )
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(req, timeout=5)
        assert exc.value.code == 413

    def test_negative_content_length_rejected(self, live_server):
        # urllib will not send a negative Content-Length, so speak HTTP directly.
        host, port = live_server.replace("http://", "").split(":")
        with socket.create_connection((host, int(port)), timeout=5) as s:
            s.sendall(
                b"POST /api/display HTTP/1.1\r\n"
                b"Host: localhost\r\nContent-Length: -1\r\n\r\n"
            )
            s.settimeout(5)
            resp = s.recv(64)
        assert b"400" in resp
```

Reuse or add a `live_server` fixture following the existing pattern in `tests/test_server.py` (ephemeral port 0, daemon thread, shutdown at teardown).

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement**

Add near the top of `server.py`:

```python
# Maximum accepted POST body. Control payloads are a few hundred bytes; this
# ceiling stops an open-LAN client from forcing a large allocation, and the
# explicit negative check stops rfile.read(-1) from blocking a request thread
# until the peer disconnects.
_MAX_BODY_BYTES = 64 * 1024
```

Add a helper on `ControlHandler`:

```python
    def _read_body(self) -> dict | None:
        """Read and parse a JSON body, or send an error and return None."""
        raw = self.headers.get("Content-Length", "0")
        try:
            length = int(raw)
        except (TypeError, ValueError):
            self.send_error(400, "Invalid Content-Length")
            return None
        if length < 0:
            self.send_error(400, "Invalid Content-Length")
            return None
        if length > _MAX_BODY_BYTES:
            self.send_error(413, "Request body too large")
            return None
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            self.send_error(400, "Malformed JSON body")
            return None
```

In `do_POST`, replace the inline length/read with:

```python
                body = self._read_body()
                if body is None:
                    return
```

- [ ] **Step 4: Set a socket timeout** so a client that promises bytes and never sends them cannot pin a thread. Add to `ControlHandler`:

```python
    timeout = 10  # BaseHTTPRequestHandler honours this on the connection
```

- [ ] **Step 5: Verify, then commit**

```bash
pytest -q && ruff check .
git add chiketi/server.py tests/test_server.py
git commit -m "fix(server): bound POST bodies at 64KiB, reject invalid Content-Length"
```

### Task 2.2: CSRF / Origin validation and CORS scoping

**Files:**
- Modify: `chiketi/server.py`
- Modify: `tests/test_server.py`

**The bug:** `post()` in `control_app.js` sends no `Content-Type` when there is no body, making it a CORS "simple request" — no preflight. Any webpage the user visits can `fetch('http://192.168.x.x:7777/api/theme/Panel/Gold', {method:'POST'})` and change the theme or turn the display off. `Access-Control-Allow-Origin: *` additionally lets any origin *read* telemetry (hostname, IP, MAC, Claude usage).

**Constraint:** must not break the control panel, which is same-origin, nor the kiosk page.

- [ ] **Step 1: Write failing tests**

```python
class TestCsrf:
    def test_cross_origin_post_rejected(self, live_server):
        req = urllib.request.Request(
            live_server + "/api/theme/Panel/Teal",
            data=b"",
            method="POST",
            headers={"Origin": "https://evil.example"},
        )
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(req, timeout=5)
        assert exc.value.code == 403

    def test_same_origin_post_allowed(self, live_server):
        req = urllib.request.Request(
            live_server + "/api/theme/Panel/Teal",
            data=b"",
            method="POST",
            headers={"Origin": live_server},
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            assert r.status == 200

    def test_post_without_origin_allowed(self, live_server):
        """curl and the control panel's own fetch send no Origin."""
        req = urllib.request.Request(
            live_server + "/api/theme/Panel/Gold", data=b"", method="POST"
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            assert r.status == 200

    def test_metrics_not_wildcard_cors(self, live_server):
        with urllib.request.urlopen(live_server + "/api/metrics", timeout=5) as r:
            assert r.headers.get("Access-Control-Allow-Origin") != "*"
```

Use `restore_active_theme` so these do not leak theme state.

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement the Origin check**

```python
def _origin_allowed(origin: str, host_header: str) -> bool:
    """Allow same-origin and null/absent Origin; reject everything else.

    A browser always sends Origin on cross-origin POSTs, so rejecting a
    mismatch blocks drive-by CSRF from any page the user visits. Requests with
    no Origin (curl, scripts, the control panel's own same-origin fetch in
    older browsers) are allowed so nothing that works today breaks.
    """
    if not origin or origin == "null":
        return True
    parsed = urlparse(origin)
    if not parsed.netloc:
        return False
    # Compare host:port against the Host header the client used to reach us.
    return parsed.netloc == host_header
```

At the top of `do_POST`, before the token check:

```python
        if not _origin_allowed(
            self.headers.get("Origin", ""), self.headers.get("Host", "")
        ):
            self.send_error(403, "Cross-origin request rejected")
            return
```

- [ ] **Step 4: Scope CORS**

In `_json_response`, replace the wildcard. Echo the Origin only when it is same-origin:

```python
        origin = self.headers.get("Origin", "")
        if origin and _origin_allowed(origin, self.headers.get("Host", "")):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
```

Drop the unconditional `Access-Control-Allow-Origin: *` line.

- [ ] **Step 5: Add security headers** to `_json_response`, `_serve_ui`, and `_serve_display`:

```python
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
```

And on the two HTML responses only:

```python
        self.send_header("X-Frame-Options", "DENY")
```

Do NOT add a restrictive `Content-Security-Policy` — both pages are built from inline `<style>` and `<script>` blocks, so any CSP without `'unsafe-inline'` breaks the product entirely. A CSP that permits `'unsafe-inline'` buys nothing here. Skip it and note why in the commit message.

- [ ] **Step 6: Verify the control panel still works end to end**

Start the server, load `/`, switch a theme, toggle a screen. Confirm no console errors and the theme actually changes. Record the result.

- [ ] **Step 7: Verify and commit**

```bash
pytest -q && ruff check .
git add chiketi/server.py tests/test_server.py
git commit -m "fix(server): reject cross-origin POSTs, scope CORS to same-origin, add nosniff/referrer headers"
```

### Task 2.3: Serialize shared state

**Files:**
- Modify: `chiketi/server.py`
- Modify: `tests/test_server.py`

**The bug:** `ThreadingHTTPServer` handles requests concurrently. `_json_response` serializes the live `_screen_rotation` dict while a concurrent POST may be inserting into it — `RuntimeError: dictionary changed size during iteration`. Composite reads of `_display_width`/`_display_height` can also tear.

- [ ] **Step 1: Write a failing concurrency test**

```python
class TestConcurrentState:
    def test_concurrent_get_and_post_do_not_race(self, live_server):
        errors = []

        def hammer_post():
            for i in range(60):
                body = json.dumps(
                    {"screen_rotation": {f"s{i}": {"enabled": True, "duration": 5}}}
                ).encode()
                try:
                    req = urllib.request.Request(
                        live_server + "/api/display", data=body, method="POST",
                        headers={"Content-Type": "application/json"},
                    )
                    urllib.request.urlopen(req, timeout=5).read()
                except Exception as exc:
                    errors.append(exc)

        def hammer_get():
            for _ in range(60):
                try:
                    urllib.request.urlopen(live_server + "/api/display", timeout=5).read()
                except Exception as exc:
                    errors.append(exc)

        threads = [threading.Thread(target=hammer_post) for _ in range(2)]
        threads += [threading.Thread(target=hammer_get) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)
        assert not errors, f"concurrent access raised: {errors[:3]}"
```

- [ ] **Step 2: Run it.** It may pass intermittently — that is the nature of a race. Run it 10 times: `pytest tests/test_server.py::TestConcurrentState -q --count=10` (or a shell loop). Record how often it fails.

- [ ] **Step 3: Implement a state lock**

```python
# Guards every module-global mutable display/rotation value below. The server
# is threaded, so a GET serializing _screen_rotation can otherwise collide with
# a POST mutating it ("dictionary changed size during iteration").
_STATE_LOCK = threading.RLock()
```

Add a snapshot helper that every response path uses:

```python
def _display_payload(display_on: bool) -> dict:
    """Immutable snapshot of display state, safe to serialize."""
    with _STATE_LOCK:
        return {
            "current_output": _display_output,
            "brightness": _display_brightness,
            "width": _display_width,
            "height": _display_height,
            "screen_rotation": {k: dict(v) for k, v in _screen_rotation.items()},
            "default_duration": TIMING.rotate_interval_s,
            "display_on": display_on,
        }
```

Replace both inline payload constructions (GET `/api/display` and the POST response) with `_display_payload(mgr.is_on if mgr else False)`. Wrap every mutation of `_screen_rotation`, `_display_width`, `_display_height`, `_display_output`, `_display_brightness` in `with _STATE_LOCK:`.

Note `mgr.is_on` must be called **outside** `_STATE_LOCK` — it takes `DisplayManager._lock` internally, and taking both in inconsistent orders across call sites would deadlock. Compute it first, pass it in.

- [ ] **Step 4: Also guard the xrandr cache** — `_XRANDR_CACHE` / `_XRANDR_CACHE_TS` are read-modify-written in `_get_xrandr_outputs`. Use the same lock, but release it before the `subprocess.run` so a 5-second xrandr timeout cannot block every other request:

```python
def _get_xrandr_outputs(force: bool = False) -> list[dict]:
    global _XRANDR_CACHE, _XRANDR_CACHE_TS
    now = time.monotonic()
    with _STATE_LOCK:
        if not force and _XRANDR_CACHE_TS and (now - _XRANDR_CACHE_TS) < _XRANDR_TTL_S:
            return list(_XRANDR_CACHE)
    fresh = _query_xrandr_outputs()      # slow; runs unlocked
    with _STATE_LOCK:
        _XRANDR_CACHE = fresh
        _XRANDR_CACHE_TS = time.monotonic()
        return list(_XRANDR_CACHE)
```

- [ ] **Step 5: Re-run the race test 10x, confirm zero failures. Verify and commit.**

```bash
pytest -q && ruff check .
git add chiketi/server.py tests/test_server.py
git commit -m "fix(server): guard shared display state with an RLock, return snapshots"
```

### Task 2.4: Brightness stored independently of output

**Files:**
- Modify: `chiketi/server.py`
- Modify: `tests/test_server.py`

**The bug:** `_apply_display_settings` assigns `_display_brightness` only inside `if output:`. With no connected outputs (headless, Wayland), the slider silently no-ops and reverts on reload, while the panel says "Settings applied".

- [ ] **Step 1: Write the failing test**

```python
def test_brightness_persists_without_output(self, live_server):
    body = json.dumps({"brightness": 1.7}).encode()
    req = urllib.request.Request(
        live_server + "/api/display", data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        assert json.loads(r.read())["brightness"] == 1.7
    with urllib.request.urlopen(live_server + "/api/display", timeout=5) as r:
        assert json.loads(r.read())["brightness"] == 1.7
```

- [ ] **Step 2: Run, confirm failure** (it returns the old `1.0`).

- [ ] **Step 3: Implement.** In `do_POST`, after clamping `brightness`, store it unconditionally:

```python
                if "brightness" in body:
                    with _STATE_LOCK:
                        _display_brightness = brightness
```

Add `_display_brightness` to the `global` declaration. `_apply_display_settings` keeps applying via xrandr when an output is given; the stored value is now independent of whether xrandr succeeded.

- [ ] **Step 4: Report per-setting outcomes.** The response already carries `applied` when xrandr ran. Make the distinction explicit so the panel can stop lying:

```python
                if applied is not None:
                    resp["applied"] = applied
                    resp["applied_detail"] = (
                        "brightness applied via xrandr" if applied
                        else "saved, but xrandr could not apply it"
                    )
```

- [ ] **Step 5: Verify and commit**

```bash
pytest -q && ruff check .
git add chiketi/server.py tests/test_server.py
git commit -m "fix(server): store brightness even when no xrandr output is selected"
```

---

## GATE 2 -> Fable QA

---

# Phase 3: Collector Accuracy

### Task 3.1: Per-interface network counters

**Files:**
- Modify: `chiketi/collectors/network.py`
- Modify: `tests/test_collectors.py`

**The bug:** `ip`, `mac`, and `speed` describe the primary interface, but throughput uses `psutil.net_io_counters()` with no `pernic=True` — a system-wide total. Docker, loopback, VPN, and secondary-NIC traffic is all attributed to the primary link. Separately, a counter reset (interface down/up) makes the delta negative, producing a negative rate.

- [ ] **Step 1: Write failing tests**

```python
class TestNetworkPerInterface:
    def test_uses_primary_interface_counters(self):
        c = NetworkCollector()
        pernic = {
            "eth0": mock.Mock(bytes_sent=1000, bytes_recv=2000),
            "docker0": mock.Mock(bytes_sent=999999, bytes_recv=999999),
        }
        with mock.patch("chiketi.collectors.network._get_primary_ip", return_value="10.0.0.5"), \
             mock.patch("chiketi.collectors.network._get_iface_for_ip", return_value="eth0"), \
             mock.patch("psutil.net_if_addrs", return_value={}), \
             mock.patch("psutil.net_if_stats", return_value={}), \
             mock.patch("psutil.net_io_counters", return_value=pernic) as io:
            c.collect()
            pernic["eth0"] = mock.Mock(bytes_sent=1000, bytes_recv=2000 + 1_000_000)
            pernic["docker0"] = mock.Mock(bytes_sent=999999, bytes_recv=99_999_999)
            time.sleep(0.05)
            metrics = c.collect()
            io.assert_called_with(pernic=True)
        # docker0's huge delta must not appear in the primary link's rate.
        dl = metrics["net.dl"].extra["raw_bytes_per_sec"]
        assert dl < 100_000_000

    def test_counter_reset_clamps_to_zero(self):
        c = NetworkCollector()
        pernic = {"eth0": mock.Mock(bytes_sent=5000, bytes_recv=9000)}
        with mock.patch("chiketi.collectors.network._get_primary_ip", return_value="10.0.0.5"), \
             mock.patch("chiketi.collectors.network._get_iface_for_ip", return_value="eth0"), \
             mock.patch("psutil.net_if_addrs", return_value={}), \
             mock.patch("psutil.net_if_stats", return_value={}), \
             mock.patch("psutil.net_io_counters", return_value=pernic):
            c.collect()
            pernic["eth0"] = mock.Mock(bytes_sent=10, bytes_recv=20)  # reset
            time.sleep(0.05)
            metrics = c.collect()
        assert metrics["net.dl"].extra["raw_bytes_per_sec"] == 0.0
        assert metrics["net.ul"].extra["raw_bytes_per_sec"] == 0.0
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement**

Track the interface alongside the counters, and reset history when the interface changes:

```python
    def __init__(self) -> None:
        self._prev_bytes_sent: int | None = None
        self._prev_bytes_recv: int | None = None
        self._prev_time: float | None = None
        self._prev_iface: str | None = None
```

In `collect`, resolve `iface` once at the top and reuse it. Then:

```python
        try:
            iface = ...  # resolved above, may be None
            pernic = psutil.net_io_counters(pernic=True)
            counters = pernic.get(iface) if iface else None
            if counters is None:
                # No primary interface identified: fall back to the aggregate so
                # the panel still shows something rather than going blank.
                counters = psutil.net_io_counters()
            now = time.monotonic()

            if self._prev_time is not None and iface == self._prev_iface:
                dt = now - self._prev_time
                if dt > 0:
                    # Clamp negatives: an interface restart resets its counters,
                    # which would otherwise show as a large negative rate.
                    dl_rate = max(0.0, (counters.bytes_recv - self._prev_bytes_recv) / dt)
                    ul_rate = max(0.0, (counters.bytes_sent - self._prev_bytes_sent) / dt)
                else:
                    dl_rate = ul_rate = 0.0
                # ... existing formatting unchanged ...
            else:
                metrics[self._key("dl")] = MetricValue(value=0.0, unit="B/s",
                                                       extra={"raw_bytes_per_sec": 0.0})
                metrics[self._key("ul")] = MetricValue(value=0.0, unit="B/s",
                                                       extra={"raw_bytes_per_sec": 0.0})

            self._prev_bytes_sent = counters.bytes_sent
            self._prev_bytes_recv = counters.bytes_recv
            self._prev_time = now
            self._prev_iface = iface
```

Note the existing first-sample branch omits `raw_bytes_per_sec` from `extra`; add it so consumers never see a missing key.

- [ ] **Step 4: Also fix the double `net_if_addrs()` call.** `_get_iface_for_ip(ip)` calls `psutil.net_if_addrs()`, and the MAC lookup immediately below calls it again. Hoist one call:

```python
def _get_iface_for_ip(ip: str, addrs: dict) -> str | None:
    """Find the interface name holding the given IP, given a pre-fetched map."""
    for iface, addr_list in addrs.items():
        for addr in addr_list:
            if addr.family == socket.AF_INET and addr.address == ip:
                return iface
    return None
```

Update the existing caller and any test that patches it.

- [ ] **Step 5: Verify and commit**

```bash
pytest -q && ruff check .
git add chiketi/collectors/network.py tests/test_collectors.py
git commit -m "fix(net): use primary-interface counters, clamp counter resets, single net_if_addrs call"
```

### Task 3.2: LLM backend correctness

**Files:**
- Modify: `chiketi/collectors/llm.py`
- Modify: `tests/test_collectors.py`

**Four bugs:**
1. `_detect_backend` can select `llama_cpp` from the HTTP `/health` probe, but `_collect_llama_cpp` derives `running` purely from the process scan — so an HTTP-discovered server reports `"Stopped"` and skips every telemetry call.
2. Ollama's `size_vram` is emitted as `llama.context`, which is a token count elsewhere. Mislabelled.
3. `self._last_tok_sec` is returned forever after generation stops — a stale rate that never decays.
4. `_collect_llama_cpp` runs a full `process_iter(['pid','name','cmdline'])` every 1.5s (86ms over 276 processes measured). Cache it.

- [ ] **Step 1: Write failing tests**

```python
class TestLlamaCppHttpDiscovery:
    def test_http_discovered_server_reports_running(self):
        c = LlmCollector()
        c._backend = "llama_cpp"
        c._backend_check_time = time.monotonic()
        with mock.patch("psutil.process_iter", return_value=iter([])), \
             mock.patch("chiketi.collectors.llm._http_get_json") as http:
            http.side_effect = lambda url, timeout=2: (
                {"status": "ok"} if "/health" in url else []
            )
            metrics = c.collect()
        assert metrics["llama.status"].value == "Running"
        assert metrics["llama.health"].value == "ok"


class TestOllamaVram:
    def test_vram_not_reported_as_context(self):
        c = LlmCollector()
        c._backend = "ollama"
        c._backend_check_time = time.monotonic()
        payload = {"models": [{"model": "qwen3:32b", "size_vram": 21474836480,
                               "details": {"quantization_level": "Q4_K_M"}}]}
        with mock.patch("chiketi.collectors.llm._http_get_json", return_value=payload):
            metrics = c.collect()
        assert "llama.context" not in metrics or metrics["llama.context"].value != "20480MB VRAM"
        assert metrics["llama.vram"].unit == "MiB"


class TestTokSecStaleness:
    def test_stale_rate_expires(self):
        c = LlmCollector()
        c._last_tok_sec = 42.0
        c._last_tok_sec_time = time.monotonic() - 60  # a minute old
        assert c._fresh_tok_sec() is None
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Fix `running` determination**

```python
        # A backend can be discovered by HTTP probe alone (containerised
        # llama-server, renamed binary). Treat a responding /health endpoint as
        # running even when no matching process name was found.
        health = _http_get_json(f"http://localhost:{port}/health")
        http_alive = isinstance(health, dict)
        running = bool(procs) or http_alive
```

Then move the health/slots block so it runs whenever `running` is true, and record `health` from the value already fetched rather than re-requesting it.

- [ ] **Step 4: Fix the Ollama VRAM mislabel**

Replace the `context` assignment with a dedicated key:

```python
            size_vram = model_info.get("size_vram", 0)
            if size_vram:
                metrics[self._key("vram")] = MetricValue(
                    value=round(size_vram / (1024 * 1024)), unit="MiB"
                )
            ctx = model_info.get("context_length") or (model_info.get("details") or {}).get("context_length")
            if ctx:
                metrics[self._key("context")] = MetricValue(value=ctx)
```

- [ ] **Step 5: Expire the stale token rate**

```python
    _TOK_SEC_TTL_S = 15.0

    def _fresh_tok_sec(self) -> float | None:
        """Return the cached token rate only while it is recent."""
        if self._last_tok_sec is None or not self._last_tok_sec_time:
            return None
        if (time.monotonic() - self._last_tok_sec_time) > self._TOK_SEC_TTL_S:
            return None
        return self._last_tok_sec
```

Initialize `self._last_tok_sec_time = 0.0` in `__init__`, set it whenever `_last_tok_sec` is assigned, and replace the `elif self._last_tok_sec is not None:` branch with `_fresh_tok_sec()`.

- [ ] **Step 6: Cache the process scan**

```python
    _PROC_CACHE_TTL_S = 10.0
```

Add `self._procs_cache: list[dict] = []` and `self._procs_cache_time: float = 0.0`. Wrap the scan:

```python
        now = time.monotonic()
        if (now - self._procs_cache_time) < self._PROC_CACHE_TTL_S:
            procs = list(self._procs_cache)
        else:
            procs = self._scan_llama_processes()   # the existing loop, extracted
            self._procs_cache = list(procs)
            self._procs_cache_time = now
```

Extract the existing loop verbatim into `_scan_llama_processes()`. This turns an 86ms-per-1.5s cost into 86ms-per-10s.

- [ ] **Step 7: Verify and commit**

```bash
pytest -q && ruff check .
git add chiketi/collectors/llm.py tests/test_collectors.py
git commit -m "fix(llm): honour HTTP-discovered backends, split VRAM from context, expire stale tok/s, cache process scan"
```

### Task 3.3: Claude collector robustness

**Files:**
- Modify: `chiketi/collectors/claude.py`
- Modify: `tests/test_collectors.py`

**Three bugs:**
1. A partially-written trailing JSONL line fails `json.loads`, is skipped, and `f.tell()` advances past it — that record is never counted.
2. Truncation/rotation to the same path is undetected; `seek(_session_pos)` past EOF yields nothing forever.
3. Switching session files resets `_session_stats` to zero while `_prev_total` still holds the old total, producing one large negative rate sample.

- [ ] **Step 1: Write failing tests**

```python
class TestClaudePartialLines:
    def test_partial_trailing_line_is_not_lost(self, tmp_path, monkeypatch):
        proj = tmp_path / "projects" / "p"
        proj.mkdir(parents=True)
        f = proj / "s.jsonl"
        monkeypatch.setattr("chiketi.collectors.claude._PROJECTS_DIR", str(tmp_path / "projects"))
        complete = json.dumps({"type": "assistant", "message": {"usage": {"output_tokens": 10}}})
        f.write_text(complete + "\n" + '{"type": "assistant", "mess')  # truncated
        c = ClaudeCollector()
        c._update_current_session()
        assert c._session_stats["output"] == 10
        # Now the writer finishes the line.
        f.write_text(complete + "\n" + json.dumps(
            {"type": "assistant", "message": {"usage": {"output_tokens": 7}}}) + "\n")
        c._update_current_session()
        assert c._session_stats["output"] == 17, "completed line was skipped"

    def test_truncation_resets_position(self, tmp_path, monkeypatch):
        proj = tmp_path / "projects" / "p"
        proj.mkdir(parents=True)
        f = proj / "s.jsonl"
        monkeypatch.setattr("chiketi.collectors.claude._PROJECTS_DIR", str(tmp_path / "projects"))
        line = json.dumps({"type": "user"}) + "\n"
        f.write_text(line * 10)
        c = ClaudeCollector()
        c._update_current_session()
        assert c._session_stats["msgs_user"] == 10
        f.write_text(line)          # truncated to one line
        c._update_current_session()
        assert c._session_stats["msgs_user"] == 1, "truncation not detected"

    def test_session_switch_emits_no_negative_rate(self, tmp_path, monkeypatch):
        # after switching session files, no sample in _rate_samples may be < 0
        ...
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Preserve incomplete trailing bytes**

Read in binary, split on `\n`, and keep the unterminated remainder for next time:

```python
        try:
            with open(self._session_file, "rb") as f:
                f.seek(self._session_pos)
                chunk = f.read()
            if not chunk:
                return
            # Keep the trailing fragment: the writer may be mid-line, and
            # advancing past it would drop that record permanently.
            consumed = chunk.rfind(b"\n") + 1
            if consumed == 0:
                return                      # nothing complete yet; try next cycle
            for raw in chunk[:consumed].split(b"\n"):
                if not raw:
                    continue
                try:
                    obj = json.loads(raw.decode("utf-8", errors="replace"))
                except (json.JSONDecodeError, ValueError):
                    continue
                # ... existing per-record accounting unchanged ...
            self._session_pos += consumed
        except Exception:
            pass
```

- [ ] **Step 4: Detect truncation**

Before seeking:

```python
        try:
            size = os.path.getsize(self._session_file)
        except OSError:
            return
        if size < self._session_pos:
            # File shrank: truncated or replaced in place. Re-read from zero.
            self._session_pos = 0
            self._session_stats = _new_session_stats()
```

Extract the repeated `{"input": 0, ...}` literal into a module-level `_new_session_stats()` factory and use it in `__init__`, on session change, and here.

- [ ] **Step 5: Reset rate state on session change**

Where the session file changes, also clear the rate history:

```python
        if latest != self._session_file:
            self._session_file = latest
            self._session_pos = 0
            self._session_stats = _new_session_stats()
            # Drop rate history: the new session's total is unrelated to the
            # old one, and the difference would land as a large negative sample.
            self._rate_samples.clear()
            self._prev_total = 0
            self._prev_time = 0.0
```

- [ ] **Step 6: Guard the rate sample itself**, since a truncation reset can also lower the total:

```python
                delta = session_total - self._prev_total
                if delta >= 0:
                    self._rate_samples.append((delta / dt) * 60)
```

- [ ] **Step 7: Verify and commit**

```bash
pytest -q && ruff check .
git add chiketi/collectors/claude.py tests/test_collectors.py
git commit -m "fix(claude): preserve partial JSONL lines, detect truncation, reset rate on session change"
```

### Task 3.4: Single `sensors_temperatures()` call

**Files:**
- Modify: `chiketi/collectors/cpu.py`

**The bug:** called at `cpu.py:41` for CPU temp and again at `:60` for motherboard temp. It is a full sysfs walk.

- [ ] **Step 1: Hoist the call** to the top of `collect()`:

```python
        try:
            temps = psutil.sensors_temperatures()
        except Exception:
            temps = {}
```

Then have both the CPU-temp and motherboard-temp blocks use that local, each keeping its own `try/except` around the *parsing* so one failing does not affect the other. The `if temp_val is None and temps:` fallback and the `"acpitz" in temps` check both continue to work against the local.

- [ ] **Step 2: Confirm the existing tests still pass.** `tests/test_collectors.py::test_temp_from_coretemp` patches `psutil.sensors_temperatures` — it must still pass unchanged. If it asserts call count, update it to expect 1.

- [ ] **Step 3: Verify and commit**

```bash
pytest -q && ruff check .
git add chiketi/collectors/cpu.py tests/test_collectors.py
git commit -m "perf(cpu): read sensors_temperatures once per collect instead of twice"
```

---

## GATE 3 -> Fable QA

---

# Phase 4: Renderer / UI

**Acceptance test for this whole phase:** delete `CHIKETI_HARNESS_ALLOW` and `CHIKETI_HARNESS_EXPECT` from `tests/test_renderers.py`, and the allowlist logic from `render_harness.js`. The harness must pass with **zero** failures.

**Corrected baseline (Gate 0 QA):** 30 allowed failures, not 21 — the original escape check was both false-positive and incomplete.

| Group | Count | What |
|---|---|---|
| `NULL_VALUES` | 14 | 7x `.length` of null on screen1, 7x `.toLocaleString` of null in `claudeScreen3` |
| `HOSTILE` | 5 | fixture-level leaks in `panelGold/Coral/TealScreen1`, `scanScreen1`, `vfdScreen1` |
| `HOSTILE_KEYS` | 11 | per-key sweep: `net.ip` + `net.mac` in those same 5 renderers, **plus `llama.health` in `terminalScreen2`** |

`terminalScreen2`/`llama.health` appears ONLY in the per-key sweep: the `HOSTILE` fixture makes `llama.status` hostile too, which disables the branch that renders `llama.health`. It is the one leaked value with genuine external provenance (it comes from the local llama.cpp `/health` response), so do not skip it.

### Task 4.1: Null-safety in renderers

**Files:**
- Modify: `chiketi/assets/ui/screen_functions.js`

**The bug:** `NULL_VALUES` fixture (available:true, value:null) throws in seven renderers on `cpu.fans_cpu`/`cpu.fans_case` (`.length` of null) and in `claudeScreen3` on six `claude.*` keys (`.toLocaleString` of null). No collector emits this shape today — this is a latent trap that makes any future collector edit a live bug.

- [ ] **Step 1: Confirm the current failures**

```bash
CHIKETI_HARNESS_ALLOW= node tests/js/render_harness.js
```
Record the exact list.

- [ ] **Step 2: Fix `fanStrip` and the inline fan expressions**

In `shared_helpers.js`/`screen_functions.js`, replace `cpuFans.available ? cpuFans.value : []` with a list coercion:

```js
function asList(d) {
  return (d && d.available && Array.isArray(d.value)) ? d.value : [];
}
```

Use `asList(cpuFans)` / `asList(caseFans)` in `fanStrip` (line ~79) and in the inline fan expression at line ~130, plus lines ~1002 and ~1258.

- [ ] **Step 3: Fix the numeric formatters in `claudeScreen3`**

Add a helper next to `fmtTok`:

```js
/* Safe thousands-separated integer. Renderers must not assume a metric
   flagged available actually carries a number. */
function fmtNum(d) {
  if (!d || !d.available || d.value == null || isNaN(d.value)) return '--';
  return Number(d.value).toLocaleString();
}
```

Replace every `X.available ? X.value.toLocaleString() : '--'` in `claudeScreen3` with `fmtNum(X)`. There are six: `msgsTotal`, `msgsUser`, `msgsAsst`, `monthlyMsg`, `sessionMsgs`, `tokenRate`. Also make `fmtTok` null-safe — it is called as `fmtTok(monthlyTok.value||0)`, which is already guarded, but harden it anyway:

```js
function fmtTok(n) {
  if (n == null || isNaN(n) || n === 0) return '0';
  ...
}
```

- [ ] **Step 4: Verify**

```bash
CHIKETI_HARNESS_ALLOW=HOSTILE node tests/js/render_harness.js
```
Expected: NULL_VALUES passes; only HOSTILE still allowed.

- [ ] **Step 5: Commit**

```bash
python scripts/gen_site_assets.py
git add chiketi/assets/ui/ docs/site/
git commit -m "fix(ui): renderers no longer throw when an available metric carries a null value"
```

### Task 4.2: Escape remaining metric interpolations

**Files:**
- Modify: `chiketi/assets/ui/screen_functions.js`

**The bug:** `net.ip` and `net.mac` (five renderers: `panelGoldScreen1`, `panelCoralScreen1`, `panelTealScreen1`, `scanScreen1`, `vfdScreen1`) and `llama.health` (`terminalScreen2`) are interpolated raw into `innerHTML` — 11 sites total while every other metric goes through `esc()`. `shared_helpers.js:1` documents escaping as the project's defense-in-depth policy; these are the gaps. `llama.health` is the only one with external provenance (it comes from the local llama.cpp `/health` response).

- [ ] **Step 1: Confirm the current failures**

```bash
CHIKETI_HARNESS_ALLOW=NULL_VALUES node tests/js/render_harness.js
```
Expected: 5 `HOSTILE` failures and 11 `HOSTILE_KEYS` failures, covering 6 renderers.

- [ ] **Step 2: Route them through `mv()`**

Each site currently reads the raw `.value`. Replace with the existing `mv(key)` helper, which already escapes and returns `'N/A'` when unavailable. Where the current code has a custom fallback string (e.g. `'--'`), preserve it:

```js
netIp.available ? esc(String(netIp.value)) : '--'
```

- [ ] **Step 3: Verify with the allowlist removed entirely**

Delete the allowlist and count-pin blocks from `render_harness.js` (restore the plain `if (failures.length) { ... process.exit(1); }` ending) and remove both `CHIKETI_HARNESS_ALLOW` and `CHIKETI_HARNESS_EXPECT` from `tests/test_renderers.py`. Keep the per-key sweep and `CHIKETI_PYTHON`.

```bash
node tests/js/render_harness.js && pytest -q && ruff check .
```
Expected: `renderer harness OK`, no allowed failures.

- [ ] **Step 4: Commit**

```bash
python scripts/gen_site_assets.py
git add chiketi/assets/ui/ tests/ docs/site/
git commit -m "fix(ui): escape net.ip/net.mac/llama.health; remove renderer harness allowlist"
```

### Task 4.3: Dynamic backend title

**Files:**
- Modify: `chiketi/assets/ui/screen_functions.js`

**The bug:** `LLAMA.CPP` is hardcoded at six sites; `llama.backend` is rendered zero times. An Ollama or vLLM user sees a panel titled "LLAMA.CPP".

- [ ] **Step 1: Add a resolver** near `cleanModel`:

```js
/* Display name for whichever LLM backend is live. The collector reports
   'llama.cpp' | 'ollama' | 'vllm' | 'none' in llama.backend. */
function backendTitle() {
  const d = m('llama.backend');
  if (!d.available || !d.value || d.value === 'none') return 'AI ENGINE';
  const names = { 'llama.cpp': 'LLAMA.CPP', ollama: 'OLLAMA', vllm: 'VLLM' };
  return names[String(d.value)] || esc(String(d.value).toUpperCase());
}
```

- [ ] **Step 2: Replace all six hardcoded occurrences** of the literal `LLAMA.CPP` with `backendTitle()`. Find them with `grep -n 'LLAMA\.CPP' chiketi/assets/ui/screen_functions.js`. Mind the two quoting styles (template literal vs concatenation).

- [ ] **Step 3: Add a harness fixture** proving it. In `fixtures.js`, add:

```js
const OLLAMA = (function () {
  const o = Object.assign({}, FULL);
  o['llama.backend'] = mval('ollama');
  o['llama.model'] = mval('qwen3:32b');
  return o;
})();
```
Export it. Then in the harness, after the existing checks:

```js
      if (fixtureName === 'OLLAMA' && html.indexOf('LLAMA.CPP') !== -1) {
        fail(fixtureName, label, 'hardcoded LLAMA.CPP shown for an ollama backend');
      }
```

- [ ] **Step 4: Verify and commit**

```bash
node tests/js/render_harness.js && pytest -q
python scripts/gen_site_assets.py
git add chiketi/assets/ui/ tests/js/ docs/site/
git commit -m "fix(ui): show the actual LLM backend instead of hardcoding LLAMA.CPP"
```

### Task 4.4: Clock screens tick every second

**Files:**
- Modify: `chiketi/assets/ui/display_app.js`

**The bug:** the display re-renders only on the 2500ms poll, but six clock renderers show live seconds. The seconds digit visibly skips (2 -> 4 -> 7).

**Constraint:** do not simply drop the poll to 1s — that triples metric traffic and re-renders 130 KB three times as often.

- [ ] **Step 1: Add a separate 1-second render tick, decoupled from polling**

```js
/* Clock screens render live seconds, so they need a 1s repaint even though
   metrics only refresh every 2.5s. Non-clock screens are left alone: a full
   innerHTML swap is ~130KB and is not worth doing every second on a Pi. */
const CLOCK_SCREEN_IDS = ['screen2'];
let clockTimer = null;

function isClockScreen() {
  const s = enabledScreens[currentScreenIdx];
  if (!s) return false;
  // Terminal's screen2 is an AI monitor, not a clock.
  return CLOCK_SCREEN_IDS.indexOf(s.id) !== -1 && activeFamily !== 'Terminal';
}

function scheduleClockTick() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  if (!isClockScreen()) return;
  clockTimer = setInterval(renderDisplay, 1000);
}
```

- [ ] **Step 2: Call `scheduleClockTick()`** everywhere `renderDisplay()` is followed by a screen change: at the end of `poll()` (after `scheduleRotate()`), in `onRotate()`, and in the keydown handler.

- [ ] **Step 3: Stop the tick when the page is hidden**, so a backgrounded kiosk tab does not repaint pointlessly:

```js
document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  } else {
    scheduleClockTick();
  }
});
```

- [ ] **Step 4: Verify**

```bash
./scripts/check_js.sh
pytest -q
```

Then start the server, open `/display`, switch to a Panel clock screen, and watch the seconds for 10 seconds. Every value 0-9 must appear in sequence with no skips. Record the observation.

- [ ] **Step 5: Commit**

```bash
python scripts/gen_site_assets.py
git add chiketi/assets/ui/display_app.js docs/site/
git commit -m "fix(ui): tick clock screens once a second so displayed seconds stop skipping"
```

---

## GATE 4 -> Fable QA

---

# Phase 5: Runtime Robustness

### Task 5.1: Dedicated Chromium profile

**Files:**
- Modify: `chiketi/app.py`
- Create/Modify: `tests/test_app.py`

**The bug:** `chrome_args` has no `--user-data-dir`. If Chromium is already running with the default profile, the new invocation hands the window off to the existing process and exits immediately. `self._proc.poll()` then reports the kiosk as dead, breaking `is_on` and making `turn_off()` a no-op.

- [ ] **Step 1: Write the failing test**

```python
class TestChromiumProfile:
    def test_launch_uses_dedicated_profile(self, tmp_path, monkeypatch):
        monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
        mgr = DisplayManager.__new__(DisplayManager)   # bypass env probing
        mgr._url = "http://localhost:7777/display"
        mgr._chromium = "/usr/bin/chromium"
        mgr._wayland = False
        mgr._session_env = {}
        mgr._display_env = ":0"
        mgr._screen_size = None
        mgr._proc = None
        mgr._adopted_pid = None
        mgr._lock = threading.Lock()
        mgr._x_vt = None
        with mock.patch("subprocess.Popen") as popen:
            popen.return_value.pid = 4242
            popen.return_value.poll.return_value = None
            mgr.turn_on()
        args = popen.call_args[0][0]
        assert any(a.startswith("--user-data-dir=") for a in args), args
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement**

```python
def _profile_dir() -> str:
    """Chromium profile owned by chiketi.

    Without a dedicated profile, launching Chromium while the user already has
    a browser open makes the new process hand its window to the running one and
    exit, which breaks process-based power detection and shutdown.
    """
    base = os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")
    path = os.path.join(base, "chiketi", "chromium-profile")
    os.makedirs(path, exist_ok=True)
    return path
```

Add to `chrome_args`, after `--app=`:

```python
                f"--user-data-dir={_profile_dir()}",
```

- [ ] **Step 4: Update `_adopt_existing`** so adoption still matches. It greps for `kiosk` and the `--app=<url>` marker, which is unaffected by the new flag. Confirm by reading, and note it in the commit message.

- [ ] **Step 5: Verify and commit**

```bash
pytest -q && ruff check .
git add chiketi/app.py tests/test_app.py
git commit -m "fix(display): give Chromium a dedicated profile so the kiosk process stays ours"
```

### Task 5.2: Filter graphical sessions by UID

**Files:**
- Modify: `chiketi/app.py`
- Modify: `tests/test_app.py`

**The bug:** `_get_graphical_session_env` iterates every loginctl session, does not filter by the calling UID, and `env.update(candidate)` merges variables from multiple sessions. On a multi-user box this can produce a `DISPLAY` from one session and an `XAUTHORITY` from another. (The `/proc` fallback path *does* filter by UID correctly.)

- [ ] **Step 1: Write the failing test** — mock `loginctl` output with two sessions owned by different UIDs, assert only the current user's environment is returned and that variables are not mixed across sessions.

- [ ] **Step 2: Implement.** Request `--property=User` (already requested but unused) and compare against `os.getuid()`:

```python
                if prop_dict.get("Type") not in ("x11", "wayland"):
                    continue
                # Only adopt a session owned by this user; merging variables
                # across sessions can pair one session's DISPLAY with another's
                # XAUTHORITY.
                if str(prop_dict.get("User", "")) != str(uid):
                    continue
```

And replace `env.update(candidate)` with an atomic first-match return so one session's variables are never blended with another's:

```python
                    candidate = _read_env_from_proc(int(leader_pid))
                    if candidate.get("DISPLAY") or candidate.get("WAYLAND_DISPLAY"):
                        return candidate
```

- [ ] **Step 3: Verify and commit**

```bash
pytest -q && ruff check .
git add chiketi/app.py tests/test_app.py
git commit -m "fix(display): only adopt this user's graphical session; keep its env atomic"
```

### Task 5.3: MetricEngine interval and shutdown

**Files:**
- Modify: `chiketi/app.py`
- Modify: `tests/test_app.py`

**Two issues:** the loop sleeps `collect_interval_ms` *after* collecting, so the real period is `collect_time + 1.5s`; and `stop()` only flips a flag, so shutdown waits out a full sleep.

- [ ] **Step 1: Write tests** asserting (a) the loop period stays near 1.5s even when a collector takes 0.4s, and (b) `stop()` returns within 200ms.

- [ ] **Step 2: Implement** with an `Event` for interruptible sleep and deadline-based scheduling:

```python
    def __init__(self) -> None:
        super().__init__()
        self._collectors: list[MetricCollector] = get_collectors()
        self._latest: dict[str, MetricValue] = {}
        self._stop = threading.Event()

    def run(self) -> None:
        interval = TIMING.collect_interval_ms / 1000
        while not self._stop.is_set():
            started = time.monotonic()
            data: dict[str, MetricValue] = {}
            for collector in self._collectors:
                try:
                    data.update(collector.collect())
                except Exception as exc:
                    print(f"chiketi: collector {type(collector).__name__} failed: {exc}",
                          file=sys.stderr)
            self._latest = data
            # Sleep the remainder of the interval, not a full interval on top
            # of collection time. Interruptible so stop() returns promptly.
            self._stop.wait(max(0.0, interval - (time.monotonic() - started)))

    def stop(self) -> None:
        self._stop.set()
```

Keep `_running` as a property alias if anything reads it — check with `grep -rn '_running' chiketi/ tests/` first.

- [ ] **Step 3: Verify and commit**

```bash
pytest -q && ruff check .
git add chiketi/app.py tests/test_app.py
git commit -m "fix(engine): hold a steady collect interval and stop promptly"
```

---

## GATE 5 -> Fable QA

---

# Phase 6: Settings Persistence

**Decision (from the user):** versioned JSON at `$XDG_CONFIG_HOME/chiketi/state.json`, defaulting to `~/.config/chiketi/state.json`. CLI flags override the file. A missing or corrupt file falls back to today's defaults — never a crash.

### Task 6.1: The state module

**Files:**
- Create: `chiketi/state.py`
- Create: `tests/test_state.py`

**Interfaces:**
- Produces: `load_state() -> dict`, `save_state(dict) -> bool`, `state_path() -> str`, `DEFAULT_STATE: dict`.

- [ ] **Step 1: Write the failing tests**

```python
class TestState:
    def test_missing_file_returns_defaults(self, tmp_path, monkeypatch):
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        assert load_state() == DEFAULT_STATE

    def test_corrupt_file_returns_defaults(self, tmp_path, monkeypatch):
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        p = Path(state_path()); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("{not json")
        assert load_state() == DEFAULT_STATE

    def test_unknown_version_returns_defaults(self, tmp_path, monkeypatch):
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        p = Path(state_path()); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"version": 999, "theme": "Panel/Teal"}))
        assert load_state() == DEFAULT_STATE

    def test_roundtrip(self, tmp_path, monkeypatch):
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        s = dict(DEFAULT_STATE, theme="Vintage/VFD", brightness=1.4)
        assert save_state(s) is True
        assert load_state()["theme"] == "Vintage/VFD"

    def test_unknown_keys_dropped(self, tmp_path, monkeypatch):
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        p = Path(state_path()); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"version": 1, "theme": "Panel/Teal", "evil": 1}))
        assert "evil" not in load_state()

    def test_invalid_theme_falls_back(self, tmp_path, monkeypatch):
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        p = Path(state_path()); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"version": 1, "theme": "Nope/Nope"}))
        assert load_state()["theme"] == DEFAULT_STATE["theme"]

    def test_save_is_atomic(self, tmp_path, monkeypatch):
        """A failed write must not leave a truncated file behind."""
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        save_state(dict(DEFAULT_STATE, theme="Panel/Teal"))
        with mock.patch("json.dump", side_effect=OSError("disk full")):
            save_state(dict(DEFAULT_STATE, theme="Vintage/VFD"))
        assert load_state()["theme"] == "Panel/Teal"
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement `chiketi/state.py`**

```python
"""Versioned settings persistence.

Settings the control panel changes at runtime live here so they survive a
restart. A missing, corrupt, or future-versioned file always degrades to
DEFAULT_STATE -- persistence must never be able to stop the dashboard booting.
"""

from __future__ import annotations

import json
import os
import tempfile

STATE_VERSION = 1

DEFAULT_STATE: dict = {
    "version": STATE_VERSION,
    "theme": "Panel/Gold",
    "screen_rotation": {},
    "brightness": 1.0,
    "output": "",
    "width": 1024,
    "height": 600,
}


def state_path() -> str:
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return os.path.join(base, "chiketi", "state.json")


def _sanitize(raw: dict) -> dict:
    """Coerce a loaded blob into DEFAULT_STATE's shape, dropping anything else."""
    from chiketi.themes import THEMES

    out = dict(DEFAULT_STATE)
    theme = raw.get("theme")
    if isinstance(theme, str) and theme in THEMES:
        out["theme"] = theme
    b = raw.get("brightness")
    if isinstance(b, (int, float)):
        out["brightness"] = max(0.3, min(2.0, float(b)))
    for key, lo, hi in (("width", 320, 3840), ("height", 200, 2160)):
        v = raw.get(key)
        if isinstance(v, int):
            out[key] = max(lo, min(hi, v))
    out_name = raw.get("output")
    if isinstance(out_name, str) and len(out_name) <= 64:
        out["output"] = out_name
    sr = raw.get("screen_rotation")
    if isinstance(sr, dict):
        clean: dict = {}
        for sid, cfg in list(sr.items())[:32]:
            if not isinstance(sid, str) or len(sid) > 64 or not isinstance(cfg, dict):
                continue
            try:
                duration = max(3, min(600, int(cfg.get("duration", 10))))
            except (TypeError, ValueError):
                continue
            clean[sid] = {"enabled": bool(cfg.get("enabled", True)), "duration": duration}
        out["screen_rotation"] = clean
    return out


def load_state() -> dict:
    try:
        with open(state_path(), encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError):
        return dict(DEFAULT_STATE)
    if not isinstance(raw, dict) or raw.get("version") != STATE_VERSION:
        return dict(DEFAULT_STATE)
    return _sanitize(raw)


def save_state(state: dict) -> bool:
    """Atomically persist state. Returns False on any failure; never raises."""
    path = state_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(dict(state, version=STATE_VERSION), fh, indent=2)
            os.replace(tmp, path)          # atomic: no truncated file on failure
            return True
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            return False
    except Exception:
        return False
```

- [ ] **Step 4: Run tests, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add chiketi/state.py tests/test_state.py
git commit -m "feat(state): versioned settings persistence with atomic writes and safe defaults"
```

### Task 6.2: Wire persistence into the server and CLI

**Files:**
- Modify: `chiketi/server.py`
- Modify: `chiketi/app.py`
- Modify: `chiketi/__main__.py`
- Modify: `tests/test_server.py`

**Precedence, in order:** CLI flag > saved state > built-in default. An explicit `--theme` must not be overwritten by the saved file, and must not itself be written back to the file (a one-off flag should not become permanent).

- [ ] **Step 1: Write the failing test** — POST a theme change and a rotation config, assert `state.json` contains them; then construct a fresh server and assert it starts with those values.

- [ ] **Step 2: Load at startup.** In `app.run()`, before creating the `DisplayManager`:

```python
    from chiketi.state import load_state
    saved = load_state()
    # A --theme flag already set the active theme; do not override it.
    if not theme_from_cli:
        from chiketi.themes import set_active_theme
        set_active_theme(saved["theme"])
    server.apply_saved_state(saved)
```

Pass `theme_from_cli: bool` into `run()` from `__main__.main()`. Give it a default of `False` so the existing signature stays backward-compatible.

- [ ] **Step 3: Add `apply_saved_state(saved)` to `server.py`**, assigning the module globals under `_STATE_LOCK`.

- [ ] **Step 4: Save on change.** Add a `_persist()` helper that snapshots current state and calls `save_state`, then call it after a successful theme POST and after a successful `/api/display` POST. Persistence failures must never fail the request:

```python
def _persist() -> None:
    """Best-effort save. A read-only home directory must not break the panel."""
    from chiketi.state import save_state
    with _STATE_LOCK:
        snapshot = {
            "theme": f"{get_active_family()}/{get_active_theme().name}",
            "screen_rotation": {k: dict(v) for k, v in _screen_rotation.items()},
            "brightness": _display_brightness,
            "output": _display_output,
            "width": _display_width,
            "height": _display_height,
        }
    save_state(snapshot)
```

- [ ] **Step 5: Isolate the tests.** Every server test that POSTs now writes to the real `~/.config`. Add an autouse fixture in `tests/conftest.py`:

```python
@pytest.fixture(autouse=True)
def isolate_state(tmp_path, monkeypatch):
    """Keep tests from reading or writing the developer's real state.json."""
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
```

- [ ] **Step 6: Verify and commit**

```bash
pytest -q && ruff check .
git add chiketi/ tests/
git commit -m "feat: persist theme, rotation, brightness and output across restarts"
```

---

## GATE 6 -> Fable QA

---

# Phase 7: Site, Licensing, Packaging, Docs, Cleanup

### Task 7.1: Website JS bugs

**Files:**
- Modify: `docs/site/site.js`

**Two bugs:**
1. `decodeURIComponent(q)` at `site.js:52` is unguarded. `?t=%` throws `URIError`, which aborts the entire script file — every IIFE after it, including the theme gallery, never runs.
2. The copy button reports success unconditionally. `navigator.clipboard.writeText(text).then(done, done)` passes `done` as the *rejection* handler, so it says "Copied" even when the API fails; and the `else { done(); }` fallback says "Copied" without attempting a copy at all.

- [ ] **Step 1: Guard the decode**

```js
  var q = (location.search.match(/[?&]t=([^&]+)/) || [])[1];
  if (q) {
    var decoded = null;
    try { decoded = decodeURIComponent(q); } catch (e) { decoded = null; }
    if (decoded) {
      var parts = decoded.split('/');
      if (parts.length === 2 && isKnownTheme(parts[0], parts[1])) def = parts;
    }
  }
```

- [ ] **Step 2: Make the copy button honest**

```js
      var done = function (ok) {
        btn.textContent = ok ? 'Copied' : 'Copy failed';
        btn.classList.toggle('copied', ok);
        setTimeout(function () {
          btn.textContent = orig;
          btn.classList.remove('copied');
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { done(true); },
          function () { done(false); }
        );
      } else {
        // execCommand fallback for non-secure contexts.
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:absolute;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        done(ok);
      }
```

Add a `.copy-failed` style in `docs/site/site.css` if `.copied` carries colour, so the failure state is visually distinct.

- [ ] **Step 3: Verify**

```bash
node --check docs/site/site.js
```

Then open `docs/index.html?t=%25` in a browser and confirm the hero renders and the gallery is populated. Record the result.

- [ ] **Step 4: Commit**

```bash
git add docs/site/site.js docs/site/site.css
git commit -m "fix(site): guard malformed ?t= decode; stop reporting failed copies as success"
```

### Task 7.2: Font licensing

**Files:**
- Create: `chiketi/assets/fonts/OFL-Antonio.txt`, `OFL-IBMPlexMono.txt`, `OFL-NixieOne.txt`, `OFL-Rajdhani.txt`, `OFL-ShareTechMono.txt`
- Create: `chiketi/assets/fonts/README.md`
- Modify: `scripts/gen_site_assets.py` (copy licences into `docs/assets/fonts/`)

**The issue:** six font families are bundled and redistributed; only Chakra Petch ships its OFL text. The SIL Open Font License requires the copyright notice and licence to travel with the font.

- [ ] **Step 1: Establish provenance.** For each of Antonio, IBM Plex Mono, Nixie One, Rajdhani, Share Tech Mono, record the upstream project, the copyright holder line, and the licence. All five are expected to be OFL 1.1 (IBM Plex Mono is OFL 1.1 as of its 2018 relicence — **verify, do not assume**). Write findings into `chiketi/assets/fonts/README.md` as a table: family, file, upstream URL, copyright line, licence.

- [ ] **Step 2: Add each licence file.** Copy the full OFL 1.1 text with that family's specific copyright line at the top, matching the format of the existing `OFL-ChakraPetch.txt`.

- [ ] **Step 3: If any font turns out not to be OFL**, stop and report it rather than inventing a licence file. Flag it for the user to decide (replace the font or obtain terms).

- [ ] **Step 4: Mirror into the docs tree.** `docs/assets/fonts/` is a duplicate required for GitHub Pages. Extend `gen_site_assets.py` to copy every `*.ttf` **and** every `OFL-*.txt` and `README.md` from `chiketi/assets/fonts/` into `docs/assets/fonts/`, so the two trees can never drift:

```python
# --- 5. mirror fonts (incl. licences) into the docs tree ---
# docs/ is served by GitHub Pages from a different root than the package, so it
# needs its own copy. Sync it here rather than by hand so licences travel too.
import shutil
FONTS_SRC = ROOT / "chiketi" / "assets" / "fonts"
FONTS_DST = ROOT / "docs" / "assets" / "fonts"
FONTS_DST.mkdir(parents=True, exist_ok=True)
for f in sorted(FONTS_SRC.iterdir()):
    if f.is_file():
        shutil.copy2(f, FONTS_DST / f.name)
```

- [ ] **Step 5: Add a licence note to the README** under a `## Licensing` heading: the project is MIT; bundled fonts are under their own licences, listed in `chiketi/assets/fonts/README.md`.

- [ ] **Step 6: Verify and commit**

```bash
python scripts/gen_site_assets.py
ls chiketi/assets/fonts/OFL-*.txt | wc -l    # expect 6
diff <(ls chiketi/assets/fonts) <(ls docs/assets/fonts) && echo "trees in sync"
git add chiketi/assets/fonts docs/assets/fonts scripts/gen_site_assets.py README.md
git commit -m "legal: ship OFL text for all bundled font families; sync font tree from the generator"
```

### Task 7.3: Packaging metadata

**Files:**
- Modify: `pyproject.toml`
- Modify: `chiketi/__init__.py`
- Delete: `setup.py`

- [ ] **Step 1: Single version source.** Keep `__version__` in `chiketi/__init__.py` and have `pyproject.toml` read it dynamically:

```toml
[project]
name = "chiketi"
dynamic = ["version"]
...

[tool.setuptools.dynamic]
version = {attr = "chiketi.__version__"}
```

Remove the static `version = "0.1.0"` line.

- [ ] **Step 2: Modernise the licence declaration.** The build currently warns that the licence table is deprecated after 2027-02-18:

```toml
license = "MIT"
license-files = ["LICENSE"]
```

Remove `license = {text = "MIT"}`. This requires setuptools >= 77; bump the build requirement:

```toml
[build-system]
requires = ["setuptools>=77.0", "wheel"]
```

- [ ] **Step 3: Add the missing metadata**

```toml
readme = "README.md"
authors = [{name = "Rohan Prakash"}]
keywords = ["dashboard", "system-monitor", "kiosk", "raspberry-pi"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Environment :: X11 Applications",
    "Intended Audience :: End Users/Desktop",
    "License :: OSI Approved :: MIT License",
    "Operating System :: POSIX :: Linux",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Python :: 3.13",
    "Topic :: System :: Monitoring",
]

[project.urls]
Homepage = "https://rohanprakash12.github.io/chiketi/"
Repository = "https://github.com/rohanprakash12/chiketi"
Issues = "https://github.com/rohanprakash12/chiketi/issues"
```

Note `Operating System :: POSIX :: Linux` is accurate: `signal.pause()` and `os.getuid()` make this Linux-only despite the GPU collector's Windows comment. Fix that stale comment in `collectors/registry.py` too.

- [ ] **Step 4: Delete `setup.py`** — `pyproject.toml` is authoritative and the shim adds nothing.

- [ ] **Step 5: Verify the build is warning-free and complete**

```bash
python -m build -o /tmp/chiketi-dist 2>&1 | grep -i 'warn\|deprecat' && echo "WARNINGS REMAIN" || echo "clean build"
unzip -p /tmp/chiketi-dist/*.whl 'chiketi-*.dist-info/METADATA' | head -30
unzip -l /tmp/chiketi-dist/*.whl | grep -c 'assets/'
```
Expected: clean build, version `0.1.0`, and **all 15 asset files still present** (9 fonts + 6 licences would be 15 once Task 7.2 lands; plus 8 UI files). Confirm nothing was dropped.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml chiketi/__init__.py chiketi/collectors/registry.py
git rm setup.py
git commit -m "build: single version source, modern licence metadata, full project URLs/classifiers"
```

### Task 7.4: Install-time autostart prompt

**Files:**
- Modify: `scripts/install.sh`
- Modify: `README.md`

**Decision (from the user):** prompt during install.

**Critical constraint:** the documented entry point is `curl -fsSL ... | bash`, where **stdin is the script itself** — a bare `read` would consume script text or fail. Read from `/dev/tty`, and when there is no tty (CI, piped non-interactive), default to **not** installing autostart. Also accept explicit `--autostart` / `--no-autostart` flags so the choice can be scripted.

- [ ] **Step 1: Parse flags** at the top of `install.sh`:

```bash
AUTOSTART=""          # "", "yes", or "no"
for arg in "$@"; do
    case "$arg" in
        --autostart)    AUTOSTART="yes" ;;
        --no-autostart) AUTOSTART="no" ;;
    esac
done
```

- [ ] **Step 2: Prompt, safely**, after the install succeeds:

```bash
# ── Optional: autostart on login ──
if [ -z "$AUTOSTART" ]; then
    # stdin is the script itself under `curl | bash`, so ask the terminal
    # directly. With no tty (CI, cron) default to no and say so.
    if [ -r /dev/tty ]; then
        printf "Enable autostart on login? [y/N] " > /dev/tty
        read -r reply < /dev/tty || reply=""
        case "$reply" in [Yy]*) AUTOSTART="yes" ;; *) AUTOSTART="no" ;; esac
    else
        AUTOSTART="no"
        warn "No terminal available; skipping autostart (re-run with --autostart)."
    fi
fi

if [ "$AUTOSTART" = "yes" ]; then
    DESKTOP_SRC="$(dirname "$0")/chiketi.desktop"
    AUTOSTART_DIR="$HOME/.config/autostart"
    mkdir -p "$AUTOSTART_DIR"
    if [ -f "$DESKTOP_SRC" ]; then
        cp "$DESKTOP_SRC" "$AUTOSTART_DIR/chiketi.desktop"
    else
        # Installed via `curl | bash`, so the repo file is not on disk.
        cat > "$AUTOSTART_DIR/chiketi.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Chiketi Dashboard
Comment=System stats dashboard for GeeekPi display
Exec=chiketi
Terminal=false
Hidden=false
X-GNOME-Autostart-enabled=true
DESKTOP
    fi
    info "Autostart enabled ($AUTOSTART_DIR/chiketi.desktop)"
fi
```

Note the heredoc must be quoted (`<<'DESKTOP'`) so nothing is expanded.

- [ ] **Step 3: Shellcheck it**

```bash
shellcheck scripts/install.sh scripts/run.sh || true
```
Fix every error-level finding. Warnings are discretionary; note any you skip.

- [ ] **Step 4: Test all three paths**

```bash
bash -n scripts/install.sh                                  # syntax
echo | bash -c 'AUTOSTART=""; . /dev/stdin' < scripts/install.sh   # no-tty path
```
Verify the no-tty path chooses `no` and prints the hint. Do not run the full installer — it invokes `sudo apt-get`.

- [ ] **Step 5: Document it in the README** install section, showing both the prompt and the flags.

- [ ] **Step 6: Commit**

```bash
git add scripts/install.sh README.md
git commit -m "feat(install): offer autostart at install time; /dev/tty prompt keeps curl|bash working"
```

### Task 7.5: Documentation drift

**Files:**
- Modify: `README.md`, `BLUEPRINT.md`, `docs/index.html`

Fix each of these, verifying the true value first rather than copying from this plan (the numbers will have moved):

- [ ] **Step 1:** Test count. `README.md:195`, `BLUEPRINT.md:74`, `BLUEPRINT.md:228` all say 83. Run `pytest -q --collect-only 2>/dev/null | tail -1` and use the real number.
- [ ] **Step 2:** Version. `docs/index.html` says `v0.2`; the package says `0.1.0`. Make the site read from one source or simply state `0.1.0`.
- [ ] **Step 3:** Autostart claim. The site says chiketi boots directly into the kiosk. That is now true only when autostart was enabled at install; reword to say so and link the flag.
- [ ] **Step 4:** Install flow. Confirm the site's install snippet ends with the actual `chiketi` launch step; add it if missing.
- [ ] **Step 5:** "Panels hide themselves" — verify against behavior. Renderers show `N/A`/`--` for unavailable metrics; they do not hide. Reword to "unavailable metrics degrade to N/A".
- [ ] **Step 6:** Backend support. The site mentions only llama.cpp; the collector supports llama.cpp, Ollama, and vLLM, and Phase 4 made the UI show which. Update the copy.
- [ ] **Step 7:** Screenshots. The README has a commented-out screenshot block. Either capture real screenshots into `screenshots/` and enable it, or delete the block. Do not leave dead markup.
- [ ] **Step 8:** Security section. Update it to describe the Phase 2 posture: same-origin POSTs only, scoped CORS, 64 KiB body cap, still open telemetry GETs on a trusted LAN by default.

- [ ] **Step 9: Commit**

```bash
git add README.md BLUEPRINT.md docs/index.html
git commit -m "docs: correct test count, version, autostart, backend and security claims"
```

### Task 7.6: Dead code removal

**Files:** various

Remove only what is provably unreferenced. **Verify each with grep before deleting** — a symbol used solely by tests is a judgement call, not automatically dead.

- [ ] **Step 1: Confirm each candidate**

```bash
for sym in DISPLAY_WIDTH DISPLAY_HEIGHT THRESHOLD_WARNING THRESHOLD_CRITICAL; do
  echo "== $sym"; grep -rn "\b$sym\b" --include='*.py' --include='*.js' chiketi/ scripts/ docs/
done
grep -rn 'web_spec()\.sizes\|PANEL_SPEC\.sizes\|\.sizes\b' chiketi/assets/ui/ docs/site/
grep -rn '_unavailable(' chiketi/
grep -rn '\.percent\b' chiketi/ | grep -v 'vm\.\|sw\.\|usage\.\|"percent"'
grep -rn 'on_theme_change\|list_themes' chiketi/ scripts/
```

- [ ] **Step 2: Remove the confirmed-dead symbols**
  - `chiketi/config.py`: `DISPLAY_WIDTH`, `DISPLAY_HEIGHT`, `THRESHOLD_WARNING`, `THRESHOLD_CRITICAL` — zero non-test references. Delete them and the tests that only assert their values (`test_config.py::test_display_dimensions`, `::test_thresholds`, `::test_warning_below_critical`).
  - `chiketi/collectors/base.py`: `MetricValue.percent` and `MetricCollector._unavailable` — zero references.
  - `chiketi/panel_spec.py`: the `"sizes"` block in `web_spec()` plus `PANEL_RADIUS_PX` / `PANEL_BAR_HEIGHT_PX` — zero references in any JS. **Update `tests/test_panel_spec.py::test_sizes_section` accordingly.**
  - `chiketi/panel_spec.py`: `CORAL_SUNFLOWER`, `CORAL_ICE`, `CORAL_BLUEY`, `CORAL_AFRICAN_VIOLET`, `CORAL_HOPBUSH`, `CORAL_GREEN`, `CORAL_GOLD`, `CORAL_BAHAMA`, `TEAL_DEEP_BLUE` — defined but never exported or used.
  - `scripts/font_test.py` — a pygame-era harness with an undeclared dependency, from an architecture the BLUEPRINT says is retired. Delete.
  - `docs/index-legacy.html` — 56 KB superseded page; git history preserves it.

- [ ] **Step 3: Keep these, with a note explaining why**
  - `themes.on_theme_change` / `_listeners` — a public extension point with real tests. Leave it; add a docstring line saying it is a public hook with no in-tree consumer.
  - `scripts/run.sh` — now referenced by the README dev workflow. **Fix its `DISPLAY` handling**: `export DISPLAY="${DISPLAY:-:1}"` guarantees `DISPLAY` is always set, which short-circuits `app._detect_display()`'s lock-file scan. Only export it when the caller explicitly asks:

    ```bash
    # Leave DISPLAY unset when the caller did not set it, so chiketi's own
    # detection (loginctl, /proc, X lock files) can run. Force with CHIKETI_DISPLAY.
    if [ -n "${CHIKETI_DISPLAY:-}" ]; then
        export DISPLAY="$CHIKETI_DISPLAY"
    fi
    ```
    Guard the `xset` calls on `[ -n "${DISPLAY:-}" ]` as they already are.
  - `plans/` and `specs/` — project history; leave in place.

- [ ] **Step 4: Regenerate, verify, commit**

```bash
python scripts/gen_site_assets.py
pytest -q && ruff check . && node tests/js/render_harness.js
git add -A
git commit -m "chore: remove unreferenced constants, helpers and the retired pygame harness"
```

### Task 7.7: CI hardening

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Install Node** in the test job so the renderer harness actually runs in CI rather than skipping:

```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
```

- [ ] **Step 2: Add generated-asset drift verification**

```yaml
      - name: Verify generated site assets are in sync
        run: |
          python scripts/gen_site_assets.py
          git diff --exit-code docs/ || {
            echo "::error::docs/ is stale. Run scripts/gen_site_assets.py and commit."
            exit 1
          }
```

- [ ] **Step 3: Smoke-test the built wheel** in the `build` job, so a packaging regression that drops `assets/ui/` fails CI:

```yaml
      - name: Smoke-test the wheel
        run: |
          python -m venv /tmp/smoke
          /tmp/smoke/bin/pip install --quiet dist/*.whl
          /tmp/smoke/bin/python - <<'PY'
          import chiketi.server as s
          for name, fn in (("display", s._build_display_html), ("control", s._build_html)):
              html = fn()
              assert len(html) > 50_000, (name, len(html))
              assert "__" not in html or "__PANEL_SPEC_JSON__" not in html, name
          print("wheel serves both pages")
          PY
```

- [ ] **Step 4: Add shellcheck**

```yaml
      - name: Lint shell scripts
        run: shellcheck scripts/*.sh
```

- [ ] **Step 5: Add Python 3.14** to the test matrix, since `requires-python = ">=3.11"` is open-ended. If it fails for an unrelated upstream reason, add it with `continue-on-error: true` and note why.

- [ ] **Step 6: Do NOT add** `ruff format --check` (never adopted; would demand 18 unrelated file changes) or a dependency vulnerability scanner (one runtime dependency). Note both decisions in the commit message.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run renderer harness on node, verify generated-asset sync, smoke-test the wheel"
```

---

## GATE 7 -> Fable QA (full-system final pass)

---

## Fable QA Gate Brief

Give this to the Fable QA agent at every gate, with `{PHASE}` and `{TASKS}` filled in.

> You are an independent QA reviewer for phase **{PHASE}** of the chiketi remediation. You did NOT write this code. Your job is to find reasons it is **not** done. Do not be agreeable.
>
> **Repository:** `/home/rohan/projects/chiketi`. Python is `.venv/bin/python`.
>
> **Changes under review:** `git log --oneline main..HEAD` and `git diff` for this phase's commits.
>
> **Tasks claimed complete:** {TASKS}
>
> Run all four stages and report each separately.
>
> **Stage 1 — Baseline.** Run `.venv/bin/python -m pytest -q`, `.venv/bin/python -m ruff check .`, and `node tests/js/render_harness.js` (once it exists). Any failure is an automatic FAIL. Report exact counts and output.
>
> **Stage 2 — Defect reproduction.** For every bug this phase claims to fix, construct an independent reproduction of the ORIGINAL defect and prove it now behaves correctly. Do not trust the tests the implementer wrote — write your own. If you cannot independently reproduce the original defect at the parent commit (`git stash` or `git worktree` an earlier commit), say so explicitly; a fix for a bug you cannot demonstrate is unverified.
>
> **Stage 3 — Regression sweep.** Identify every caller and consumer of each changed function. Check for behavior that changed without being intended. Pay particular attention to: the "no breaking changes" constraint (`chiketi` with no arguments must still bind `0.0.0.0:7777` with no auth and serve a working control panel); the wheel still containing all of `chiketi/assets/ui/`; and `docs/site/` being regenerated when any UI asset changed (`python scripts/gen_site_assets.py && git diff --exit-code docs/`).
>
> **Stage 4 — Adversarial.** Actively try to break each fix. Feed boundary values, empty inputs, concurrent access, and malformed data. For every fix, ask "what input makes this wrong again?" and try it. Report what you tried, including attempts that failed to break it.
>
> **Verdict.** End with exactly one line: `VERDICT: PASS` or `VERDICT: FAIL`, followed by a numbered list of blocking findings (file:line, what is wrong, how to reproduce). PASS only if all four stages are clean. If something is ambiguous rather than wrong, list it under `NON-BLOCKING` and still pass.

---

## Self-Review

**Spec coverage.** Every verified finding from both audits maps to a task:

| Finding | Task |
|---|---|
| Disk TiB rendered as 0.0T | 1.1 |
| `--rotate-interval 0` hot loop | 1.2 |
| Unbounded Content-Length | 2.1 |
| CSRF / wildcard CORS / missing headers | 2.2 |
| Threaded state race | 2.3 |
| Brightness false success | 2.4 |
| Aggregate vs per-interface network counters | 3.1 |
| Counter-reset negative rate | 3.1 |
| Double `net_if_addrs()` | 3.1 |
| HTTP-discovered llama.cpp reports Stopped | 3.2 |
| Ollama VRAM labelled as context | 3.2 |
| Stale tok/sec never expires | 3.2 |
| `process_iter` every 1.5s | 3.2 |
| Claude partial-line loss | 3.3 |
| Claude truncation undetected | 3.3 |
| Negative rate on session switch | 3.3 |
| `sensors_temperatures()` twice | 3.4 |
| Renderer null-value crashes | 4.1 |
| Unescaped net.ip/net.mac/llama.health | 4.2 |
| Hardcoded LLAMA.CPP / unused llama.backend | 4.3 |
| Clock seconds skip | 4.4 |
| No Chromium `--user-data-dir` | 5.1 |
| Session env not UID-filtered / merged | 5.2 |
| Engine interval drift + slow stop | 5.3 |
| No settings persistence | 6.1, 6.2 |
| No autostart install | 7.4 |
| site.js decodeURIComponent throw | 7.1 |
| Clipboard false success | 7.1 |
| Font licensing incomplete | 7.2 |
| Version drift, licence deprecation, thin metadata | 7.3 |
| sdist missing conftest/fixtures | 0.2 |
| "83 tests", v0.2, autostart, backend claims | 7.5 |
| Dead constants/helpers, setup.py, legacy html, font_test.py | 7.6 |
| No JS tests, low coverage, CI gaps | 0.1, 7.7 |
| `run.sh` pre-empts display detection | 7.6 |

**Deliberately not done, with reasons:**
- **`ruff format`** — never adopted; reformatting 18 files would bury the real changes. Noted in 7.7.
- **Dependency vulnerability scanning** — one runtime dependency (`psutil`). Ceremony.
- **Restrictive CSP** — both pages are built from inline `<style>`/`<script>`; any CSP without `'unsafe-inline'` breaks the product, and one with it buys nothing. Noted in 2.2.
- **Auth on telemetry GETs / refusing to bind `0.0.0.0`** — the user chose to keep current defaults. The CSRF fix in 2.2 closes the drive-by vector, which was the part that survived the trusted-LAN assumption.
- **`Math.max` -> `Math.min` display scaling** — deliberate cover-fit for the 1024x600 target, not a defect. Task 7.5 fixes the *documentation* claim instead.
- **DOM-diffing the dashboard instead of `innerHTML`** — a rewrite of all 15 renderers, disproportionate to the benefit and high-risk against a 68%-covered UI. Task 4.4 addresses the user-visible symptom (clock skew) at a fraction of the risk.

**Type consistency.** `fmtCapacity(d)` / `fmtCapacityTotal(d)` (1.1), `asList(d)` / `fmtNum(d)` (4.1), `backendTitle()` (4.3) are all defined once and referenced consistently. `load_state()` / `save_state()` / `state_path()` / `DEFAULT_STATE` (6.1) match their use in 6.2. `build_parser()` / `validate_args()` (1.2) match `main()`. `_display_payload(display_on)` (2.3) is used by both the GET and POST paths. `_new_session_stats()` (3.3) replaces three duplicated dict literals.

**Ordering risk.** Task 3.2 renames Ollama's `llama.context` to `llama.vram`. Renderers reading `llama.context` will show `N/A` for Ollama users between Phase 3 and Phase 4. That is strictly better than today's mislabelled VRAM figure, and Task 4.3's `OLLAMA` fixture covers the pairing. Flagged for the Gate 3 reviewer.
