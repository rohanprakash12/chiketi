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
// What the pages inline as SCREEN_SPEC (assets/ui/screens.json), and the
// display global kioskNotice() picks its skin from.
const SCREEN_SPEC = JSON.parse(fs.readFileSync(path.join(UI, 'screens.json'), 'utf8'));
let activeFamily = null;

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
  fs.readFileSync(path.join(UI, 'screen_functions.js'), 'utf8') +
  // const bindings stay inside this eval; hand out what the checks below need.
  '\nglobalThis.__HARNESS = { skins: [BS_SKIN_TOS, BS_SKIN_CLAUDE] };'
);

// Every theme with every screen its modes offer, from the one resolver the
// display, the control panel and the site use (screenRenderer). Nothing may
// fall through to another family's renderer: `gpu` once defaulted to
// sfTosGpuScreen, so the six Terminal palettes were "tested" against a Sci-Fi
// board and the four distro GPU screens were never rendered at all.
const THEME_LIST = [];
for (const fam of Object.keys(FAMILIES)) for (const v of Object.keys(FAMILIES[fam])) THEME_LIST.push([fam, v]);
const REGISTRY = THEME_LIST.map(function (fv) {
  const key = fv[0] + '/' + fv[1];
  const ids = Object.keys(SCREEN_SPEC.modes).filter(function (md) { return themeAllowed(md, key); })
    .reduce(function (a, md) { return a.concat(SCREEN_SPEC.modes[md].screens); }, []);
  const screens = ids.map(function (id) {
    const r = screenRenderer(id, fv[0], fv[1]);
    return r && { id: id, fn: r.fn, fluid: r.fluid };
  }).filter(Boolean);
  return { family: fv[0], variant: fv[1], screens: screens, fns: screens.map(function (x) { return x.fn; }) };
});

/* ── The frame model: the frame follows the screen's shape ── */
(function () {
  setFrameH(683);
  if (frameH() !== 683 || layoutClass() !== 'landscape' || fluidH() !== 683) {
    console.error('FRAME MODEL: 3:2 frame not landscape/683'); process.exit(1);
  }
  setFrameH(1200);
  if (layoutClass() !== 'other' || fluidH() !== 770) {
    console.error('FRAME MODEL: portrait frame must fall back to clamped landscape'); process.exit(1);
  }
  setFrameH('junk');
  if (frameH() !== 600) { console.error('FRAME MODEL: bad input must reset to 600'); process.exit(1); }
  setFrameH(600);
  if (bsFrame('x', true).indexOf('screen-frame fluid') === -1 ||
      bsFrame('x').indexOf('screen-frame fluid') !== -1) {
    console.error('FRAME MODEL: bsFrame fluid flag'); process.exit(1);
  }
})();

// Screens that print the SECONDARY (/home) capacity as a "used / total"
// string. Used by the LARGE_DISK assertions below.
const TIB_CAPACITY_SCREENS = [
  'sfTosScreen1', 'sfTngScreen1', 'sfDs9Screen1',
  'scanScreen1', 'tubeScreen1', 'vfdScreen1',
];

// Screens that print the live LLM backend as a panel title. Note the panel is
// on screen1 for Sci-Fi/Vintage and on screen2 for Terminal.
//
// Only Terminal is left: the Bridge Station rebuild moved the NPU readout off
// screen 1 across both the Panel and Vintage families to make room for the
// chronometer. It returns when each family's screen 2 is rebuilt; re-add the
// six screen1s then.
const BACKEND_TITLE_SCREENS = ['terminalScreen2'];


/* ── Layout px never scales ────────────────────────────────────────────────
 * .screen-frame is 1024px wide on the kiosk and about 350px in the control
 * panel, and cqw is what bridges the two. A screen sized in absolute px
 * renders the same size in both, so a preview gets 1010x480 of content in a
 * 352x206 box -- which is exactly what shipped on the distro boards.
 *
 * Hairlines (<= 2px) are exempt: a 1px rule is a 1px rule at any size.
 *
 * ALLOWLIST is a ratchet, not a blessing. Those renderers predate the check
 * and still size their instruments in px, so their control-panel previews are
 * wrong today. New screens must not join them.
 */
const PX_ALLOWLIST = new Set([]);
const PX_PROPS = 'font-size|width|height|gap|padding|padding-left|padding-right|' +
  'padding-top|padding-bottom|margin|margin-left|margin-right|margin-top|' +
  'margin-bottom|left|right|top|bottom';

function layoutPxHits(html) {
  const re = new RegExp('(?:^|[;"\\s])(' + PX_PROPS + '):\\s*(-?\\d+(?:\\.\\d+)?)px', 'g');
  const out = new Set();
  let m;
  while ((m = re.exec(html))) {
    if (Math.abs(parseFloat(m[2])) <= 2) continue;
    out.add(m[1] + ':' + m[2] + 'px');
  }
  return [...out];
}

/* ── FULL must actually be full ──────────────────────────────────────────
 * Every assertion below runs against fixtures, so a metric key the renderers
 * read but no fixture supplies is a screen that is only ever tested in its
 * empty state. Four keys were in exactly that position (sys.kernel,
 * sys.top_procs, net.iface, net.ping): the distro boards drew a process table
 * that no test had ever seen carry a process. Read the keys out of the
 * renderer source and require FULL to define them. */
(function () {
  const src = fs.readFileSync(path.join(UI, 'screen_functions.js'), 'utf8');
  const re = /\bm\('([a-z]+\.[a-z_]+)'\)/g;
  const missing = [];
  const seen = new Set();
  let mm;
  while ((mm = re.exec(src))) {
    if (seen.has(mm[1])) continue;
    seen.add(mm[1]);
    if (!(mm[1] in FIX.FULL)) missing.push(mm[1]);
  }
  if (missing.length) {
    console.error('HARNESS GAP: screen_functions.js reads metric keys that the '
      + 'FULL fixture does not define, so those code paths are only ever '
      + 'rendered unavailable: ' + missing.sort().join(', '));
    process.exit(1);
  }
})();

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
    entry.fns.forEach(function (fn) {
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
    const fns = entry.fns;
    fns.forEach(function (fn, i) {
      const sid = entry.screens[i].id;
      const label = entry.family + '/' + entry.variant + ' ' + sid + ' (' + fn.name + ')';
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
      if (fixtureName === 'HOSTILE' || fixtureName === 'GPU_HOSTILE' || fixtureName === 'SESS_HOSTILE' ||
          fixtureName === 'HL_HOSTILE' || fixtureName === 'GPU_HOUSE_HOSTILE') {
        const leak = leakReason(fn.name, html);
        if (leak) fail(fixtureName, label, 'unescaped metric reached output -- ' + leak);
      }

      // Layout px does not scale between the kiosk and the control panel.
      if (fixtureName === 'FULL' && !PX_ALLOWLIST.has(fn.name)) {
        const px = layoutPxHits(html);
        if (px.length) {
          fail(fixtureName, label,
               'layout px will not scale in the control panel -- ' + px.slice(0, 6).join(' '));
        }
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
      // Slot 4 is the GPU screen in every family (see REGISTRY, which mirrors
      // getScreenRegistry's fixed order). Matching on the function NAME instead
      // let the four distro boards -- distroArchGpu and friends -- skip all
      // three assertions below, so they were rendered but never checked.
      if ((fixtureName === 'FULL' || fixtureName === 'GPU_IDLE') && sid === 'screen4') {
        if (/NOT EXPOSED BY NVIDIA/i.test(html)) {
          fail(fixtureName, label, 'claims NVIDIA does not expose per-process VRAM');
        }
      }

      // The Sci-Fi clock is fluid: it fills any landscape shape.
      if (fixtureName === 'FULL' && /^sf(Tos|Tng|Ds9)Screen2$/.test(fn.name) &&
          html.indexOf('screen-frame fluid') === -1) {
        fail(fixtureName, label, 'Sci-Fi clock must be fluid');
      }

      // Home Lab: every state says what it is; all clear shows no issue cards.
      if (/Homelab$/.test(fn.name)) {
        const want = { FULL: 'ALL SYSTEMS NOMINAL', HL_YELLOW: 'YELLOW ALERT', HL_RED: 'RED ALERT',
                       HL_STALE: 'TELEMETRY STALE', HL_PENDING: 'ACQUIRING TELEMETRY',
                       HL_UNCONFIGURED: 'HOME LAB NOT CONFIGURED' }[fixtureName];
        if (want && html.indexOf(want) === -1) fail(fixtureName, label, 'banner missing "' + want + '"');
        if (fixtureName === 'HL_RED' && !/\+\d+ MORE/.test(html)) {
          fail(fixtureName, label, 'issues dropped without saying how many');
        }
        if (fixtureName === 'FULL' && /SINCE/.test(html)) fail(fixtureName, label, 'all-clear shows issue cards');
        if (html.indexOf('screen-frame fluid') === -1) fail(fixtureName, label, 'Home Lab must be fluid');
      }

      // Claude Sessions: waiting first, every state says what it is, never cropped silently.
      if (/Sessions$/.test(fn.name)) {
        const want = { FULL: 'NEEDS INPUT', SESS_EMPTY: 'NO ACTIVE SESSIONS', SESS_OFFLINE: 'SESSION FEED OFFLINE',
                       SESS_PENDING: 'CONNECTING', SESS_UNCONFIGURED: 'NOT CONFIGURED' }[fixtureName];
        if (want && html.indexOf(want) === -1) fail(fixtureName, label, 'missing "' + want + '"');
        if (fixtureName === 'FULL' && !(html.indexOf('nfs2seredux-e0') < html.indexOf('kiosk-deploy-ef') &&
            html.indexOf('kiosk-deploy-ef') < html.indexOf('tests-a1') && html.indexOf('tests-a1') < html.indexOf('ai-fabric-5f'))) {
          fail(fixtureName, label, 'sessions not ordered waiting, working, shell, idle');
        }
        if (fixtureName === 'SESS_MANY' && !/\+\d+ MORE/.test(html)) fail(fixtureName, label, 'sessions dropped silently');
        if (html.indexOf('screen-frame fluid') === -1) fail(fixtureName, label, 'Claude Sessions must be fluid');
      }

      // GPUs: each fixture says what it is; power is never sold as more than it is.
      if (/Gpus$/.test(fn.name)) {
        const want = { FULL: '2 GPUS', GPU_HOUSE_NONE: 'NO GPUS REPORTED', GPU_HOUSE_INCOMPLETE: 'GPU INVENTORY INCOMPLETE',
                       GPU_HOUSE_INCOMPLETE_WITH_ROWS: 'NOT REACHED', GPU_HOUSE_PENDING_WITH_ROWS: 'NOT REACHED',
                       GPU_HOUSE_STALE: 'TELEMETRY STALE', GPU_HOUSE_STALE_EMPTY: 'NO GPUS REPORTED',
                       GPU_HOUSE_MIXED_POWER: 'W FROM 1 OF 3 GPUS', GPU_HOUSE_ONE_OFFLINE: '100 W FROM 1 OF 2 GPUS',
                       HL_PENDING: 'ACQUIRING TELEMETRY' }[fixtureName];
        if (want && html.indexOf(want) === -1) fail(fixtureName, label, 'missing "' + want + '"');
        if (fixtureName === 'GPU_HOUSE_STALE_EMPTY' && html.indexOf('TELEMETRY STALE') === -1) fail(fixtureName, label, 'stale banner missing over an empty body');
        if (fixtureName === 'FULL' && html.indexOf('W NOW') === -1) fail(fixtureName, label, 'no W NOW total');
        if (fixtureName === 'GPU_HOUSE_ONE_OFFLINE' && html.indexOf('W NOW') !== -1) fail(fixtureName, label, 'subtotal sold as W NOW');
        if (fixtureName === 'GPU_HOUSE_NONE' && / W( |<|$)/.test(html.replace(/GPUS/g, ''))) fail(fixtureName, label, 'power shown for no GPUs');
        if (fixtureName === 'GPU_HOUSE_STALE' && html.indexOf('CRITICAL') === -1) fail(fixtureName, label, 'cached CRITICAL word lost');
        if (fixtureName === 'GPU_HOUSE_SPARSE' && (/>\s*0%\s*</.test(html) || /NaN/.test(html))) fail(fixtureName, label, 'missing value shown as 0% or NaN');
        if (fixtureName === 'GPU_HOUSE_MANY' && !/\+\d+ MORE/.test(html)) fail(fixtureName, label, 'GPUs dropped silently');
        if (html.indexOf('screen-frame fluid') === -1) fail(fixtureName, label, 'GPUs must be fluid');
      }

      // The empty state has to say why it is empty.
      // Case-insensitive, and either phrasing: the Sci-Fi and Vintage boards
      // shout NO GPU DETECTED, the Terminal and distro boards say it in their
      // own lowercase voice. What matters is that the blank screen says why.
      if (fixtureName === 'GPU_NONE' && sid === 'screen4' &&
          !/no (readable )?(gpu|graphics)/i.test(html)) {
        fail(fixtureName, label, 'no-GPU state does not explain itself');
      }

      // More cards than the grid holds: declare the overflow, never truncate
      // silently. GPU_MANY carries seven.
      if (fixtureName === 'GPU_MANY' && sid === 'screen4' &&
          !/\+3 more not shown/i.test(html)) {
        fail(fixtureName, label, 'cards dropped from the grid without saying so');
      }

      // The LLM panel title must follow llama.backend, not a hardcoded
      // engine name. Case-insensitive: sfTngScreen1 renders its headers
      // in lower case, so it hardcoded 'llama.cpp', not 'LLAMA.CPP'.
      if (fixtureName === 'OLLAMA' && /llama\.cpp/i.test(html)) {
        fail(fixtureName, label, 'hardcoded llama.cpp shown for an ollama backend');
      }
      // ...and the positive half, so a renderer that simply dropped the title
      // cannot pass. The panel lives on screen1 for Sci-Fi/Vintage and on
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
    const fns = entry.fns;
    fns.forEach(function (fn, i) {
      metrics = Object.assign({}, FIX.FULL);
      metrics[key] = Object.assign({}, FIX.FULL[key], { value: PAYLOAD });
      const label = entry.family + '/' + entry.variant + ' ' + entry.screens[i].id
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

// Fluid screens at every supported shape: must render cleanly and stay in cqw.
[246, 576, 600, 640, 683, 768].forEach(function (h) {
  setFrameH(h);
  ['FULL', 'SESS_MANY', 'SESS_OFFLINE', 'HL_RED', 'HL_YELLOW'].forEach(function (fx) {
    metrics = FIX[fx];
    REGISTRY.forEach(function (entry) {
      const colors = FAMILIES[entry.family][entry.variant];
      entry.screens.filter(function (x) { return x.fluid; }).map(function (x) { return x.fn; }).forEach(function (fn) {
        const label = 'h=' + h + ' ' + entry.variant + ' ' + fn.name;
        let html;
        try { html = fn(colors); } catch (e) { fail(fx, label, 'threw ' + e.message); return; }
        const dirty = html.match(/undefined|NaN|\[object Object\]/);
        if (dirty) fail(fx, label, 'output contains ' + dirty[0]);
        const px = layoutPxHits(html);
        if (px.length) fail(fx, label, 'layout px -- ' + px.slice(0, 4).join(' '));
      });
    });
  });
});
setFrameH(600);

/* ── Registry completeness ── */
THEME_LIST.forEach(function (fv) {
  const key = fv[0] + '/' + fv[1];
  ['screen1', 'screen2', 'screen3', 'screen4'].forEach(function (id) {
    if (!screenRenderer(id, fv[0], fv[1])) fail('REGISTRY', key, 'no renderer for ' + id);
  });
  if (fv[0] !== 'Terminal' && !screenRenderer('screen5', fv[0], fv[1])) fail('REGISTRY', key, 'no clock');
  SCREEN_SPEC.modes.kiosk.screens.forEach(function (id) {
    const built = SCREEN_SPEC.screens[id].built, r = screenRenderer(id, fv[0], fv[1]);
    if (themeAllowed('kiosk', key) && built && !r) fail('REGISTRY', key, 'no Kiosk renderer for ' + id);
    if (!themeAllowed('kiosk', key) && r) fail('REGISTRY', key, 'Kiosk renderer outside the Kiosk themes: ' + id);
  });
});
/* Every tab colour role exists in the Kiosk skins. */
__HARNESS.skins.forEach(function (skin) {
  SCREEN_SPEC.modes.kiosk.screens.forEach(function (id) {
    const col = SCREEN_SPEC.screens[id].color;
    if (col.charAt(0) !== '#' && !skin[col]) fail('REGISTRY', skin.key, 'tab colour role ' + col + ' missing');
  });
});

/* ── Plans: the Go bug. Every coloured tab leads to a listed screen, every
   selected screen has a tab in order, and no unselected screen has one. The
   expected lists come from the fixtures, not from the planner itself. ── */
(function () {
  const kiosk = SCREEN_SPEC.modes.kiosk.screens;
  const READY = { FULL: ['lab', 'sessions', 'gpus'], HL_UNCONFIGURED: ['sessions'], SESS_UNCONFIGURED: ['lab', 'gpus'],
                  KIOSK_EMPTY: [] };
  const cases = [];
  for (let mask = 0; mask < (1 << kiosk.length); mask += 5) cases.push(kiosk.filter(function (_, i) { return mask & (1 << i); }));
  cases.push(['lab', 'sessions'], ['sessions', 'lab'], ['lab'], [], kiosk.slice().reverse());
  const ids = function (html, attr) {
    const re = new RegExp(attr + '="([a-z0-9]+)"', 'g'), out = [];
    let mm;
    while ((mm = re.exec(html))) out.push(mm[1]);
    return out;
  };
  Object.keys(READY).forEach(function (fx) {
    metrics = FIX[fx];
    [['Sci-Fi', 'TOS'], ['Others', 'Claude']].forEach(function (fv) {
      activeFamily = fv[0];
      cases.forEach(function (sel) {
        const label = fx + ' ' + fv[1] + ' [' + sel.join(',') + ']';
        const expected = sel.filter(function (id) { return READY[fx].indexOf(id) !== -1; });
        const plan = screenPlan({ mode: 'kiosk', screens: sel, family: fv[0], variant: fv[1] });
        const listed = plan.list.map(function (x) { return x.id; });
        if (listed.join() !== expected.join()) fail('PLAN', label, 'list ' + listed.join() + ' != ' + expected.join());
        if (plan.empty !== (expected.length === 0)) fail('PLAN', label, 'empty flag wrong');
        if (plan.tabs.map(function (t) { return t.id; }).join() !== sel.join()) fail('PLAN', label, 'tabs are not the selection');
        plan.tabs.forEach(function (t) {
          if (t.live !== (expected.indexOf(t.id) !== -1)) fail('PLAN', label, 'tab ' + t.id + ' live=' + t.live);
        });
        [600, 683, 246].forEach(function (h) {
          setFrameH(h);
          setTabPlan(plan.tabs);
          const fn = plan.empty ? kioskNotice : plan.list[0].fn;
          let html;
          try { html = fn(FAMILIES[fv[0]][fv[1]]); } catch (e) { fail('PLAN', label, 'threw ' + e.message); return; }
          if (ids(html, 'data-screen').join() !== expected.join()) {
            fail('PLAN', label + ' h=' + h, 'tappable tabs ' + ids(html, 'data-screen').join() + ' != ' + expected.join());
          }
          if (ids(html, 'data-tab').join() !== sel.join()) fail('PLAN', label + ' h=' + h, 'tab order ' + ids(html, 'data-tab').join());
          if (plan.empty && html.indexOf('NO SCREENS TO SHOW') === -1) fail('PLAN', label, 'empty plan without the notice');
          const dirty = html.match(/undefined|NaN|\[object Object\]/);
          if (dirty) fail('PLAN', label + ' h=' + h, 'output contains ' + dirty[0]);
          const px = layoutPxHits(html);
          if (px.length) fail('PLAN', label + ' h=' + h, 'layout px -- ' + px.slice(0, 4).join(' '));
        });
      });
    });
  });
  setTabPlan(null); setFrameH(600); metrics = FIX.FULL;
  // Self fallbacks live in the plan too.
  let p = screenPlan({ mode: 'self', screens: [], family: 'Terminal', variant: 'hacker' });
  if (!(p.fallback && p.list.length === 1 && p.list[0].id === 'screen1')) fail('PLAN', 'self []', 'no fallback');
  p = screenPlan({ mode: 'self', screens: ['screen5'], family: 'Terminal', variant: 'hacker' });
  if (!(p.fallback && p.list.length === 1 && p.list[0].id === 'screen1')) fail('PLAN', 'self [clock] on Terminal', 'no fallback');
  p = screenPlan({ mode: 'self', screens: ['screen3', 'screen1'], family: 'Vintage', variant: 'VFD' });
  if (p.fallback || p.list.map(function (x) { return x.id; }).join() !== 'screen3,screen1') fail('PLAN', 'self order', 'order lost');
  if (p.tabs.length) fail('PLAN', 'self', 'Self has no tabs');
  p = screenPlan({ mode: 'kiosk', screens: ['overview', 'lab'], family: 'Sci-Fi', variant: 'TOS' });
  if (p.list.map(function (x) { return x.id; }).join() !== 'lab' || p.tabs[0].live) fail('PLAN', 'placeholder', 'grey tab live');
  p = screenPlan({ mode: 'bogus', screens: null, family: 'Sci-Fi', variant: 'TOS' });
  if (p.mode !== 'self' || p.list.length !== 5) fail('PLAN', 'unknown mode', 'not treated as Self defaults');
})();

/* ── GPUs: every state word, exact worst-first order with ties, exact overflow
   counts, status colour precedence, prototype-safe host names, strip ages,
   and staleness at its boundary. ── */
(function () {
  const LABEL = { critical: 'CRITICAL', hot: 'HOT', throttling: 'THROTTLING', unreadable: 'UNREADABLE',
                  offline: 'OFFLINE', nodetail: 'NO DETAIL', unknown: 'UNKNOWN', busy: 'BUSY', idle: 'IDLE' };
  const ORDER = ['critical', 'hot', 'throttling', 'unreadable', 'offline', 'nodetail', 'unknown', 'busy', 'idle'];
  const nowS = Math.floor(Date.now() / 1000);
  const withRows = function (rows, extra) {
    const g = Object.assign({}, FIX.FULL['homelab.gpus'], { value: rows });
    if (extra) g.extra = Object.assign({}, g.extra, extra);
    return Object.assign({}, FIX.FULL, { 'homelab.gpus': g });
  };
  const expected = function (fx) {
    const hosts = fx['homelab.gpu_hosts'].value.map(function (h) { return h.host; });
    return fx['homelab.gpus'].value.slice().sort(function (a, b) {
      return (ORDER.indexOf(a.state) - ORDER.indexOf(b.state)) || (hosts.indexOf(a.host) - hosts.indexOf(b.host)) ||
        (a.index - b.index);
    }).map(function (r) { return esc(String(r.host)) + '|' + r.index; });
  };
  [['Sci-Fi', 'TOS', sfTosGpus], ['Others', 'Claude', claudeGpus]].forEach(function (t) {
    activeFamily = t[0];
    const colors = FAMILIES[t[0]][t[1]];
    [600, 683, 246].forEach(function (h) {
      setFrameH(h);
      const where = t[1] + ' h=' + h;
      Object.keys(LABEL).forEach(function (st) {
        const row = { host: 'gpubox', index: 0, name: 'V100', util: 50, vram_used: 1, vram_total: 2,
                      temp: st === 'critical' ? 95 : st === 'hot' ? 87 : 60, power: 1, power_limit: 2, fan: null,
                      procs: 1, state: st, detail: st !== 'nodetail', seen_at: nowS - 300 };
        metrics = withRows([row]);
        const html = t[2](colors);
        if (html.indexOf('>' + LABEL[st] + '<') === -1) fail('GPUS', st + ' ' + where, 'state word missing');
        if ((st === 'offline' || st === 'unreadable') && html.indexOf('SEEN') === -1) fail('GPUS', st + ' ' + where, 'no SEEN age on a cached row');
      });
      ['GPU_HOUSE', 'GPU_HOUSE_TIES', 'GPU_HOUSE_MANY'].forEach(function (name) {
        metrics = FIX[name];
        const html = t[2](colors);
        const got = (html.match(/data-gpu-row="([^"]*)"/g) || []).map(function (x) { return x.slice(14, -1); });
        const want = expected(FIX[name]);
        if (!got.length) fail('GPUS', name + ' ' + where, 'no rows rendered');
        if (got.join() !== want.slice(0, got.length).join()) fail('GPUS', name + ' ' + where, 'order ' + got.join() + ' != ' + want.join());
        const more = /\+(\d+) MORE/.exec(html);
        if (got.length < want.length ? !(more && Number(more[1]) === want.length - got.length) : !!more) {
          fail('GPUS', name + ' ' + where, 'MORE ' + (more && more[1]) + ' with ' + got.length + ' of ' + want.length);
        }
      });
      metrics = FIX.GPU_HOUSE_STALE;
      if (t[2](colors).indexOf('SEEN') === -1) fail('GPUS', 'stale ' + where, 'stale rows need their age');
      metrics = FIX.GPU_HOUSE_STALE_EMPTY;
      if (t[2](colors).indexOf('TELEMETRY STALE') === -1) fail('GPUS', 'stale empty ' + where, 'no stale banner');
    });
  });
  setFrameH(600);
  activeFamily = 'Sci-Fi';
  bsSkin(__HARNESS.skins[0]);
  const S = bsS();
  const colour = function (fx) { metrics = fx; return gpuStatusColor(gpuHouseData()); };
  if (colour(FIX.GPU_HOUSE_STALE) !== S.warn || bsTabAttention().gpus !== S.warn) fail('GPUS', 'stale+critical', 'must be warn');
  if (colour(FIX.GPU_HOUSE) !== S.crit || bsTabAttention().gpus !== S.crit) fail('GPUS', 'critical', 'not crit');
  if (colour(FIX.GPU_HOUSE_PENDING_WITH_ROWS) !== S.edge || bsTabAttention().gpus !== null) fail('GPUS', 'pending host with rows', 'must stay calm');
  if (colour(FIX.GPU_HOUSE_INCOMPLETE_WITH_ROWS) !== S.warn) fail('GPUS', 'unreadable host named constructor', 'must warn');
  if (colour(FIX.GPU_HOUSE_INCOMPLETE) !== S.warn) fail('GPUS', 'no rows, host offline', 'must warn');
  if (colour(FIX.FULL) !== S.edge) fail('GPUS', 'FULL', 'healthy must be calm');
  const after = FIX.FULL['homelab.gpus'].extra.stale_after;
  metrics = withRows(FIX.FULL['homelab.gpus'].value, { published_at: nowS - after + 5 });
  if (gpuHouseData().stale) fail('GPUS', 'boundary', 'stale before stale_after');
  metrics = withRows(FIX.FULL['homelab.gpus'].value, { published_at: nowS - after - 5 });
  if (!gpuHouseData().stale) fail('GPUS', 'boundary', 'not stale after stale_after');
  metrics = FIX.FULL;
})();

if (failures.length) {
  failures.forEach(function (f) { console.error(f); });
  console.error('\n' + failures.length + ' renderer failures');
  process.exit(1);
}
console.log('renderer harness OK');
