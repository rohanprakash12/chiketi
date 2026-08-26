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

   Exit code is 0 on success, non-zero when there is at least one blocking
   failure. Each problem prints as `FAIL <fixture> <label>: <reason>`.
   CHIKETI_HARNESS_ALLOW is a comma-separated list of fixture names whose
   failures are reported but do not affect the exit code. */

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
  { family: 'Panel', variant: 'Gold', fns: [panelGoldScreen1, panelGoldScreen2] },
  { family: 'Panel', variant: 'Coral', fns: [panelCoralScreen1, panelCoralScreen2] },
  { family: 'Panel', variant: 'Teal', fns: [panelTealScreen1, panelTealScreen2] },
  { family: 'Vintage', variant: 'Scanlines', fns: [scanScreen1, scanScreen2] },
  { family: 'Vintage', variant: 'Tubes', fns: [tubeScreen1, tubeScreen2] },
  { family: 'Vintage', variant: 'VFD', fns: [vfdScreen1, vfdScreen2] },
  { family: 'Terminal', variant: 'hacker', fns: [terminalScreen1, terminalScreen2] },
];

// Screens that print the SECONDARY (/home) capacity as a "used / total"
// string. Used by the LARGE_DISK assertions below.
const TIB_CAPACITY_SCREENS = [
  'panelGoldScreen1', 'panelCoralScreen1', 'panelTealScreen1',
  'scanScreen1', 'tubeScreen1', 'vfdScreen1',
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
      // Assert on the surviving raw '<', not on 'onerror=': the payload's
      // attribute text remains present (and harmless) once escaped, and some
      // renderers uppercase metrics first, so matching 'onerror=' both misses
      // uppercase leaks and false-positives on correctly-escaped output.
      // A raw '<img' can only appear if esc() was skipped.
      if (fixtureName === 'HOSTILE' && /<\s*img/i.test(html)) {
        fail(fixtureName, label, 'unescaped metric reached output');
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
    const fns = entry.fns.concat([claudeScreen3]);
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
      if (/<\s*img/i.test(html)) {
        fail('HOSTILE_KEYS', label, 'unescaped ' + key + ' reached output');
      }
    });
  }
}

const allow = (process.env.CHIKETI_HARNESS_ALLOW || '').split(',').filter(Boolean);
const blocking = failures.filter(function (f) {
  return !allow.some(function (a) { return f.indexOf('FAIL ' + a + ' ') === 0; });
});
failures.forEach(function (f) { console.error(f); });
if (blocking.length) {
  console.error('\n' + blocking.length + ' blocking renderer failures');
  process.exit(1);
}

// Pin the allowed count. The allowlist is fixture-scoped, so without this a
// NEW failure inside an already-allowed fixture would be silently swallowed
// until Phase 4 removes the allowlist entirely.
const allowed = failures.length - blocking.length;
const expected = process.env.CHIKETI_HARNESS_EXPECT;
if (expected !== undefined && allowed !== Number(expected)) {
  console.error(
    '\nallowed-failure count drifted: expected ' + expected + ', got ' + allowed +
    '. A new failure appeared in an allowed fixture, or one was fixed without ' +
    'updating CHIKETI_HARNESS_EXPECT.'
  );
  process.exit(1);
}
console.log('renderer harness OK (' + allowed + ' allowed failures)');
