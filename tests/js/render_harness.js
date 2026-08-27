/* Node renderer harness.

   Loads the real shared_helpers.js + screen_functions.js out of
   chiketi/assets/ui/ and renders every (fixture x theme x screen) combination,
   asserting that nothing throws and nothing obviously broken reaches the HTML.

   NOTE ON MODULE MODE: this file deliberately does NOT declare 'use strict'.
   screen_functions.js is not a module -- it declares bare top-level functions
   and reads globals that display_app.js supplies. The only way to make those
   declarations visible here is a sloppy-mode direct eval, which puts function
   declarations into this module's variable environment. Both UI files are
   eval'd as ONE concatenated source (exactly as server.py splices them into
   display_app.js), because `const GOLD = ...` in shared_helpers.js lands in the
   eval's own lexical scope and would be invisible to a second, separate eval.

   Exit code is 0 on success, non-zero when anything fails. Each problem
   prints as `FAIL <fixture> <label>: <reason>`. There is no allowlist: every
   fixture must render cleanly. */

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

// shared_helpers.js reads PANEL_SPEC at load time, so it must already be bound
// (it is, above). Concatenated into a single eval -- see the note at the top.
eval(
  fs.readFileSync(path.join(UI, 'shared_helpers.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(UI, 'screen_functions.js'), 'utf8')
);

// Mirrors getScreenRegistry() in display_app.js.
const REGISTRY = [
  { family: 'Panel', variant: 'Gold', fns: [panelGoldScreen1, panelGoldScreen2],
    gpu: panelGoldGpuScreen },
  { family: 'Panel', variant: 'Coral', fns: [panelCoralScreen1, panelCoralScreen2],
    gpu: panelCoralGpuScreen },
  { family: 'Panel', variant: 'Teal', fns: [panelTealScreen1, panelTealScreen2],
    gpu: panelTealGpuScreen },
  { family: 'Vintage', variant: 'Scanlines', fns: [scanScreen1, scanScreen2],
    gpu: scanGpuScreen },
  { family: 'Vintage', variant: 'Tubes', fns: [tubeScreen1, tubeScreen2],
    gpu: tubeGpuScreen },
  { family: 'Vintage', variant: 'VFD', fns: [vfdScreen1, vfdScreen2],
    gpu: vfdGpuScreen },
  { family: 'Terminal', variant: 'hacker', fns: [terminalScreen1, terminalScreen2] },
];

// Screens that print the SECONDARY (/home) capacity as a "used / total"
// string. Used by the LARGE_DISK assertions below.
const TIB_CAPACITY_SCREENS = [
  'panelGoldScreen1', 'panelCoralScreen1', 'panelTealScreen1',
  'scanScreen1', 'tubeScreen1', 'vfdScreen1',
];

// Screens that print the live LLM backend as a panel title. Note the panel is
// on screen1 for Panel/Vintage and on screen2 for Terminal.
//
// Only Terminal is left: the Bridge Station rebuild moved the NPU readout off
// screen 1 across both the Panel and Vintage families to make room for the
// chronometer. It returns when each family's screen 2 is rebuilt; re-add the
// six screen1s then.
const BACKEND_TITLE_SCREENS = ['terminalScreen2'];

/* Leak detection by tokenizing, not by pattern-matching a payload.
   
   The obvious check -- does the output contain "<img"? -- is defeated by any
   renderer that transforms a value character by character. nixieDigit() wraps
   every character in its own <span>, so an unescaped "<img src=x>" comes out
   as "<span>&lt;</span><span>i</span>..." with no contiguous "<img" anywhere,
   and two real leaks in tubeScreen1 hid behind exactly that for a whole phase.

   Instead: walk the HTML and flag (a) any '<' that does not open a well-formed
   tag, and (b) any tag NAME that does not appear in the same renderer's clean
   render. Both are impossible unless esc() was skipped, and neither depends on
   the payload surviving intact. */
function tokenize(html) {
  const tags = new Set();
  const stray = [];
  const tagRe = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^<>"'])*)>/;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    const mres = tagRe.exec(html.slice(lt, lt + 4000));
    if (mres) {
      tags.add(mres[2].toLowerCase());
      i = lt + mres[0].length;
    } else {
      stray.push(lt);
      i = lt + 1;
    }
  }
  return { tags, stray };
}

/* Tag vocabulary each renderer legitimately emits, from a clean FULL render. */
const CLEAN_TAGS = {};
(function () {
  const saved = metrics;
  metrics = FIX.FULL;
  for (const entry of REGISTRY) {
    const colors = FAMILIES[entry.family][entry.variant];
    entry.fns.concat([claudeScreen3, entry.gpu || panelGoldGpuScreen]).forEach(function (fn) {
      if (CLEAN_TAGS[fn.name]) return;
      try {
        CLEAN_TAGS[fn.name] = tokenize(fn(colors)).tags;
      } catch (e) {
        CLEAN_TAGS[fn.name] = new Set();
      }
    });
  }
  metrics = saved;
})();

/* The vocabulary check assumes the payload's tag is NOT one a renderer
   legitimately emits. If that ever stops being true, pass-through leak
   detection silently degrades for that renderer -- so assert it. */
(function () {
  for (const fnName of Object.keys(CLEAN_TAGS)) {
    if (CLEAN_TAGS[fnName].has('img')) {
      console.error(
        'HARNESS BROKEN: ' + fnName + ' legitimately emits <img>, so the '
        + 'hostile payload <img ...> can no longer be distinguished from '
        + 'normal output. Change PAYLOAD to a tag no renderer emits.'
      );
      process.exit(2);
    }
  }
})();

/* Returns a reason string when html carries an unescaped metric, else null. */
function leakReason(fnName, html) {
  const t = tokenize(html);
  if (t.stray.length) {
    const at = t.stray[0];
    return 'stray "<" at ' + at + ': ' + JSON.stringify(html.slice(at, at + 40));
  }
  const clean = CLEAN_TAGS[fnName] || new Set();
  for (const tag of t.tags) {
    if (!clean.has(tag)) return 'injected <' + tag + '> tag not in the clean render';
  }
  return null;
}

const failures = [];
function fail(fixture, label, reason) {
  failures.push('FAIL ' + fixture + ' ' + label + ': ' + reason);
}

for (const fixtureName of Object.keys(FIX)) {
  metrics = FIX[fixtureName];
  for (const entry of REGISTRY) {
    const colors = FAMILIES[entry.family][entry.variant];
    const fns = entry.fns.concat([claudeScreen3, entry.gpu || panelGoldGpuScreen]);
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
      // Assert on the surviving raw '<', not on 'onerror=': the payload's
      // attribute text remains present (and harmless) once escaped, and some
      // renderers uppercase metrics first, so matching 'onerror=' both misses
      // uppercase leaks and false-positives on correctly-escaped output.
      if (fixtureName === 'HOSTILE' || fixtureName === 'GPU_HOSTILE') {
        const leak = leakReason(fn.name, html);
        if (leak) fail(fixtureName, label, 'unescaped metric reached output -- ' + leak);
      }

      // A driver that exposes no utilisation must not render as 0%. The
      // viewer cannot tell that apart from a genuinely idle card, and the
      // whole point of carrying nulls through the collector is to say
      // "unknown" rather than to invent a number.
      if (fixtureName === 'GPU_SPARSE' && /GpuScreen$/.test(fn.name)) {
        if (/>\s*0%\s*</.test(html)) {
          fail(fixtureName, label, 'absent utilisation rendered as 0%');
        }
        if (!/--/.test(html)) {
          fail(fixtureName, label, 'no absent-value marker for a driver that reports nothing');
        }
      }

      // An empty NVML process list means the card is idle, not that the
      // data is unavailable -- the screen said "not exposed by nvidia" on a
      // real 3090 Ti, which is simply false. FULL's card is an idle NVML one.
      if ((fixtureName === 'FULL' || fixtureName === 'GPU_IDLE') &&
          /GpuScreen$/.test(fn.name)) {
        if (/NOT EXPOSED BY NVIDIA/i.test(html)) {
          fail(fixtureName, label, 'claims NVIDIA does not expose per-process VRAM');
        }
      }

      // The empty state has to say why it is empty.
      if (fixtureName === 'GPU_NONE' && /GpuScreen$/.test(fn.name) &&
          !/NO GPU DETECTED/.test(html)) {
        fail(fixtureName, label, 'no-GPU state does not explain itself');
      }

      // More cards than the grid holds: declare the overflow, never truncate
      // silently. GPU_MANY carries seven.
      if (fixtureName === 'GPU_MANY' && /GpuScreen$/.test(fn.name) &&
          !/\+3 MORE NOT SHOWN/.test(html)) {
        fail(fixtureName, label, 'cards dropped from the grid without saying so');
      }

      // The LLM panel title must follow llama.backend, not a hardcoded
      // engine name. Case-insensitive: panelCoralScreen1 renders its headers
      // in lower case, so it hardcoded 'llama.cpp', not 'LLAMA.CPP'.
      if (fixtureName === 'OLLAMA' && /llama\.cpp/i.test(html)) {
        fail(fixtureName, label, 'hardcoded llama.cpp shown for an ollama backend');
      }
      // ...and the positive half, so a renderer that simply dropped the title
      // cannot pass. The panel lives on screen1 for Panel/Vintage and on
      // screen2 for Terminal -- pin it per renderer rather than per index.
      if (fixtureName === 'OLLAMA' && BACKEND_TITLE_SCREENS.indexOf(fn.name) !== -1 &&
          !/ollama/i.test(html)) {
        fail(fixtureName, label, 'backend title "ollama" missing');
      }

      // A >=1 TiB disk must never render as 0.0. disk.py switches to TiB units
      // at that size; a renderer that assumes GiB divides by 1000 and produces
      // "0.0T". The LARGE_DISK fixture's /home is 1.2 TiB of 4.0 TiB.
      if (fixtureName === 'LARGE_DISK' && /(^|[^\d])0\.0\s*T/.test(html)) {
        fail(fixtureName, label, 'TiB-unit disk rendered as 0.0T');
      }
      // ...and the negative check alone would also pass on a renderer that
      // dropped the capacity entirely, so pin the expected string for the six
      // screens that actually print it. (Terminal formats it as "1.2/4T" and
      // has always been unit-aware, so it is not in this list.)
      if (fixtureName === 'LARGE_DISK' && TIB_CAPACITY_SCREENS.indexOf(fn.name) !== -1 &&
          !/1\.2T\s*\/\s*4\.0T/.test(html)) {
        fail(fixtureName, label, 'expected /home capacity "1.2T / 4.0T" missing');
      }
    });
  }
}

// Per-key hostile sweep.
//
// The HOSTILE fixture replaces every string metric at once, which can DISABLE
// the code path under test: terminalScreen2 only renders llama.health when
// llama.status reads "Running", so a HOSTILE llama.status hides a real raw
// leak in llama.health. Mutating one key at a time is strictly more thorough.
const PAYLOAD = '<img src=x onerror=alert(1)>';
const STRING_KEYS = Object.keys(FIX.FULL).filter(function (k) {
  return typeof FIX.FULL[k].value === 'string';
});

for (const key of STRING_KEYS) {
  for (const entry of REGISTRY) {
    const colors = FAMILIES[entry.family][entry.variant];
    const fns = entry.fns.concat([claudeScreen3, entry.gpu || panelGoldGpuScreen]);
    fns.forEach(function (fn, i) {
      metrics = Object.assign({}, FIX.FULL);
      metrics[key] = Object.assign({}, FIX.FULL[key], { value: PAYLOAD });
      const label = entry.family + '/' + entry.variant + ' screen' + (i + 1)
        + ' (' + fn.name + ') <- ' + key;
      let html;
      try {
        html = fn(colors);
      } catch (e) {
        fail('HOSTILE_KEYS', label, 'threw ' + e.message);
        return;
      }
      const leak = leakReason(fn.name, html);
      if (leak) {
        fail('HOSTILE_KEYS', label, 'unescaped ' + key + ' reached output -- ' + leak);
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
