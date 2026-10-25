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
const crypto = require('crypto');
const { execFileSync } = require('child_process');

/* Deterministic renders (the golden hashes and the theme-switch comparisons need
   them): one fixed instant and UTC, set before the fixtures read the clock, and a
   seeded Math.random that each compared render resets. */
process.env.TZ = 'UTC';
const HARNESS_NOW_MS = Date.UTC(2026, 9, 24, 14, 3, 0);
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(HARNESS_NOW_MS); else super(...a); }
  static now() { return HARNESS_NOW_MS; }
}
globalThis.Date = FrozenDate;
function seedRandom(n) {
  let a = n >>> 0;
  Math.random = function () {        // mulberry32
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
seedRandom(1);
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
// The Kiosk looks follow screen_functions.js, as server.py inlines them.
const KIOSK_JS = ['kiosk_looks.js', 'kiosk_scifi.js', 'kiosk_terminal.js', 'kiosk_retro.js'];
eval(
  fs.readFileSync(path.join(UI, 'shared_helpers.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(UI, 'screen_functions.js'), 'utf8') + '\n' +
  KIOSK_JS.map(function (f) { return fs.readFileSync(path.join(UI, f), 'utf8'); }).join('\n') +
  // const bindings stay inside this eval; hand out what the checks below need.
  '\nglobalThis.__HARNESS = { skins: [BS_SKIN_TOS, BS_SKIN_CLAUDE],' +
  ' distroSkins: DISTRO_SKINS,' +
  ' allSkins: function () { return [BS_SKIN_TOS, BS_SKIN_DS9, BS_SKIN_TNG, BS_SKIN_CLAUDE, BS_SKIN_SCAN, BS_SKIN_TUBE, BS_SKIN_VFD, DISTRO_SKINS]; },' +
  ' resetState: function () { for (const k of Object.keys(DISTRO_HIST)) delete DISTRO_HIST[k]; } };'
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

/* The Kiosk themes, from screens.json (never a hard-coded list), and each look's
   own words for the states the checks below look for. A Kiosk theme with no
   words entry fails: a new look must say how it spells its states. */
const KIOSK_THEMES = THEME_LIST.filter(function (fv) { return themeAllowed('kiosk', fv[0] + '/' + fv[1]); });
const GPU_WORDS = { critical: 'CRITICAL', hot: 'HOT', throttling: 'THROTTLING', unreadable: 'UNREADABLE',
                    offline: 'OFFLINE', nodetail: 'NO DETAIL', unknown: 'UNKNOWN', busy: 'BUSY', idle: 'IDLE' };
const BS_WORDS = {
  lab: { FULL: 'ALL SYSTEMS NOMINAL', KIOSK_CALM: 'ALL SYSTEMS NOMINAL', HL_YELLOW: 'YELLOW ALERT', HL_RED: 'RED ALERT',
         HL_BUSY: 'RED ALERT', HL_STALE: 'TELEMETRY STALE', HL_PENDING: 'ACQUIRING TELEMETRY',
         HL_UNCONFIGURED: 'HOME LAB NOT CONFIGURED' },
  sessions: { FULL: 'NEEDS INPUT', SESS_BUSY: 'NEEDS INPUT', SESS_EMPTY: 'NO ACTIVE SESSIONS', SESS_OFFLINE: 'SESSION FEED OFFLINE',
              SESS_PENDING: 'CONNECTING', SESS_UNCONFIGURED: 'NOT CONFIGURED' },
  gpus: { FULL: '2 GPUS', GPU_HOUSE_NONE: 'NO GPUS REPORTED', GPU_HOUSE_INCOMPLETE: 'GPU INVENTORY INCOMPLETE',
          GPU_HOUSE_INCOMPLETE_WITH_ROWS: 'NOT REACHED', GPU_HOUSE_PENDING_WITH_ROWS: 'NOT REACHED',
          GPU_HOUSE_STALE: 'TELEMETRY STALE', GPU_HOUSE_STALE_EMPTY: 'NO GPUS REPORTED',
          GPU_HOUSE_MIXED_POWER: 'W FROM 1 OF 3 GPUS', GPU_HOUSE_ONE_OFFLINE: '100 W FROM 1 OF 2 GPUS',
          HL_PENDING: 'ACQUIRING TELEMETRY' },
  // How a GPU state word is written, and whether rows are grouped by host.
  gpuWord: function (st) { return GPU_WORDS[st]; }, gpuGrouped: false, more: /\+(\d+) MORE/,
};
const KIOSK_WORDS = { 'Sci-Fi/TOS': BS_WORDS, 'Others/Claude': BS_WORDS };
// The new looks (kiosk_*.js): their own words, plus what the LOOKS block checks.
const LOOK_WORDS = function (lab, over) {
  return Object.assign({}, BS_WORDS, { lab: Object.assign({}, BS_WORDS.lab, lab) }, over || {});
};
KIOSK_WORDS['Sci-Fi/TNG'] = LOOK_WORDS({ HL_YELLOW: 'CONDITION YELLOW' }, { gpuGrouped: true, tallSess683: 7,
  status: { ok: '#CC99CC', warn: '#FFCC66', crit: '#FF5544' } });
['cyan', 'amber', 'phosphor', 'red_alert', 'blue', 'hacker'].forEach(function (v) {
  KIOSK_WORDS['Terminal/' + v] = LOOK_WORDS({ FULL: 'GREEN', KIOSK_CALM: 'GREEN', HL_YELLOW: 'YELLOW', HL_RED: 'RED', HL_BUSY: 'RED',
    HL_STALE: 'STALE', HL_PENDING: 'PENDING', HL_UNCONFIGURED: 'home lab not configured' }, { ci: true, more: /\+(\d+) more/i,
    gpus: Object.assign({}, BS_WORDS.gpus, { FULL: '2 cards', HL_PENDING: 'acquiring telemetry' }),
    gpuWord: function (st) { return GPU_WORDS[st].toLowerCase(); }, status: { ok: '', warn: '', crit: '' },
    memCount: function (html) { return (html.match(/data-mem/g) || []).length; },
    memHas: function (html, t) { return new RegExp('data-mem[^>]*>\\s*' + t + 'C<').test(html); } });
});
['Arch', 'Ubuntu', 'openSUSE', 'Mandriva'].forEach(function (v) {
  KIOSK_WORDS['Terminal/' + v] = LOOK_WORDS({ FULL: 'green', KIOSK_CALM: 'green', HL_YELLOW: 'yellow', HL_RED: 'red', HL_BUSY: 'red',
    HL_STALE: 'stale', HL_PENDING: 'pending', HL_UNCONFIGURED: 'home lab not configured' }, { ci: true, more: /\+(\d+) more/i,
    alertsByHost: true, hostCap: 12,
    gpus: Object.assign({}, BS_WORDS.gpus, { FULL: 'gpus ', HL_PENDING: 'acquiring telemetry' }),
    gpuWord: function (st) { return GPU_WORDS[st].toLowerCase(); }, status: { ok: '', warn: '', crit: '' },
    memCount: function (html) { return (html.match(/data-mem/g) || []).length; },
    memHas: function (html, t) { return new RegExp('data-mem[^>]*>mem ' + t + '&deg;<').test(html); } });
});
KIOSK_WORDS['Sci-Fi/DS9'] = LOOK_WORDS({ FULL: 'GREEN', KIOSK_CALM: 'GREEN', HL_YELLOW: 'YELLOW', HL_RED: 'RED', HL_BUSY: 'RED' }, {
  status: { ok: '#2A9D8F', warn: '#F2A33A', crit: '#FF3B30' } });
// Phase 2. Scanlines speaks today's TOS words; its frame has no worst-colour part.
KIOSK_WORDS['Vintage/Scanlines'] = LOOK_WORDS({}, { status: { ok: '', warn: '', crit: '' }, tallSess770: 7 });
// VFD lights its words: checked only where lit, and states in their own legends.
KIOSK_WORDS['Vintage/VFD'] = LOOK_WORDS({ FULL: 'NORMAL', KIOSK_CALM: 'NORMAL', HL_YELLOW: 'CAUTION', HL_RED: 'ALERT', HL_BUSY: 'ALERT',
  HL_STALE: 'STALE · CHECKED', HL_PENDING: 'ACQUIRING TELEMETRY', HL_UNCONFIGURED: 'HOME LAB NOT CONFIGURED' }, {
  lit: true, tallSess770: 7, condWords: ['NORMAL', 'CAUTION', 'ALERT'], legend: ['BUSY', 'IDLE', 'THROT', 'HOT'],
  gpuWord: function (st) { return { busy: 'BUSY', idle: 'IDLE', throttling: 'THROT', hot: 'HOT', critical: 'HOT' }[st] || GPU_WORDS[st]; },
  // Big rows light the legend word, smaller rows the full word.
  gpuLit: function (st) { return [{ busy: 'BUSY', idle: 'IDLE', throttling: 'THROT', hot: 'HOT', critical: 'HOT' }[st], GPU_WORDS[st]].filter(Boolean); },
  status: { ok: '', warn: '', crit: '' },
  memCount: function (html) { return (html.match(/data-mem/g) || []).length; },
  memHas: function (html, t) { return new RegExp('data-mem[^>]*>(?:<span[^>]*>)?MEM ' + t + '&deg;<').test(html); },
  upper: true });
const wordsFor = function (fam, v) { return KIOSK_WORDS[fam + '/' + v]; };
// Whether html says `word`, in the look's case (the Terminal looks speak lower case).
const reEsc = function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
const has = function (W, html, word) {
  // A lit look (VFD) spells every state in its unlit legends too: only lit text counts.
  if (W && W.lit) return new RegExp('data-lit[^>]*>[^<]*' + reEsc(word)).test(html);
  return W && W.ci ? html.toLowerCase().indexOf(word.toLowerCase()) !== -1 : html.indexOf(word) !== -1;
};
/* State containers (VFD): <div data-cond> / <div data-state>, markup up to its </div>. */
const containers = function (html, marker) {
  return html.split('<div ' + marker).slice(1).map(function (x) { return x.slice(0, x.indexOf('</div>')); });
};
const litIn = function (box, word) { return new RegExp('data-lit[^>]*>\\s*' + reEsc(word) + '\\s*<').test(box); };
const litOnly = function (box, word, legend) {
  return litIn(box, word) && legend.every(function (w) { return w === word || !litIn(box, w); });
};
// The helpers must reject: a ghost-only word, the wrong legend word lit, and the word lit
// outside the container.
(function () {
  const ghost = '<span style="color:#13241e">BUSY</span>', lit = function (w) { return '<span data-lit style="color:#0f0">' + w + '</span>'; };
  const L = ['BUSY', 'IDLE', 'THROT', 'HOT'];
  const t1 = containers('<div data-state>' + ghost + lit('IDLE') + '</div>', 'data-state')[0];
  const t2 = containers('<div data-state>' + lit('BUSY') + lit('HOT') + '</div>', 'data-state')[0];
  const t3 = containers('<div data-state>' + ghost + '</div>' + lit('BUSY'), 'data-state')[0];
  const t4 = containers('<div data-state>' + ghost + lit('THROT') + '</div>', 'data-state')[0];
  if (litOnly(t1, 'BUSY', L) || litOnly(t2, 'BUSY', L) || litOnly(t3, 'BUSY', L) || !litOnly(t4, 'THROT', L)) {
    console.error('HARNESS BROKEN: litOnly accepts a ghost, a second lit word or a word outside its container'); process.exit(2);
  }
})();
/* Which layout a frame drew: 'strip' only when it says so. A full layout
   letterboxed on a strip is still the full layout (its MEM lines are fine). */
const layoutOf = function (html) { return /class="screen-frame[^"]*\bstrip\b/.test(html) ? 'strip' : 'full'; };
/* Images: only the Tubes assets, and only plain attributes. */
const imgReason = function (html) {
  const re = /<img\b((?:"[^"]*"|'[^']*'|[^<>"'])*)>/gi;
  let mm;
  while ((mm = re.exec(html))) {
    const attrs = mm[1].match(/([a-zA-Z-]+)\s*=/g) || [];
    for (const a of attrs) {
      const n = a.replace(/\s*=$/, '').toLowerCase();
      if (['src', 'alt', 'style', 'class'].indexOf(n) === -1) return 'img attribute ' + n;
    }
    const src = /\bsrc="([^"]*)"/.exec(mm[1]);
    if (!src || !/^\/assets\/tubes\/[a-z0-9-]+\.webp\?v=[0-9a-f]+$/.test(src[1])) return 'img src ' + (src ? src[1] : '(none)');
  }
  return null;
};

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
  const src = ['screen_functions.js'].concat(KIOSK_JS).map(function (f) {
    return fs.readFileSync(path.join(UI, f), 'utf8');
  }).join('\n');
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
    if (CLEAN_TAGS[fnName].has('video')) {
      console.error(
        'HARNESS BROKEN: ' + fnName + ' legitimately emits <video>, so the '
        + 'hostile payload <video ...> can no longer be distinguished from '
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
    const W = wordsFor(entry.family, entry.variant);
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
      const img = imgReason(html);
      if (img) fail(fixtureName, label, img);
      // Assert on the surviving raw '<', not on 'onerror=': the payload's
      // attribute text remains present (and harmless) once escaped, and some
      // renderers uppercase metrics first, so matching 'onerror=' both misses
      // uppercase leaks and false-positives on correctly-escaped output.
      if (/HOSTILE$/.test(fixtureName)) {
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
      // Keyed by screen id, in each look's own words (KIOSK_WORDS).
      if (sid === 'lab') {
        const want = W.lab[fixtureName];
        if (want && W.condWords && W.condWords.indexOf(want) !== -1) {
          const box = containers(html, 'data-cond')[0];
          if (!box || !litOnly(box, want, W.condWords)) fail(fixtureName, label, 'condition "' + want + '" not the one lit');
        } else if (want && !has(W, html, want)) fail(fixtureName, label, 'banner missing "' + want + '"');
        if (W.condWords && fixtureName === 'HL_STALE' && !litOnly(containers(html, 'data-cond')[0] || '', 'CAUTION', W.condWords)) fail(fixtureName, label, 'stale must light CAUTION only');
        if (W.condWords && fixtureName === 'HL_PENDING' && W.condWords.some(function (w) { return litIn(containers(html, 'data-cond')[0] || '', w); })) fail(fixtureName, label, 'pending lights a condition');
        // (The new looks show what fits and count the rest exactly: the LOOKS block.)
        if (fixtureName === 'HL_RED' && !W.status && !W.more.test(html)) {
          fail(fixtureName, label, 'issues dropped without saying how many');
        }
        if (fixtureName === 'FULL' && html.indexOf('Issue 0') !== -1) fail(fixtureName, label, 'all-clear shows issue cards');
        if (html.indexOf('screen-frame fluid') === -1) fail(fixtureName, label, 'Home Lab must be fluid');
      }

      // Claude Sessions: waiting first, every state says what it is, never cropped silently.
      if (sid === 'sessions') {
        const want = W.sessions[fixtureName];
        if (want && !has(W, html, want)) fail(fixtureName, label, 'missing "' + want + '"');
        // (VFD writes names in capitals.)
        const at = function (t) { return html.indexOf(W.upper ? t.toUpperCase() : t); };
        if (fixtureName === 'FULL' && !(at('nfs2seredux-e0') < at('kiosk-deploy-ef') &&
            at('kiosk-deploy-ef') < at('tests-a1') && at('tests-a1') < at('ai-fabric-5f') && at('nfs2seredux-e0') !== -1)) {
          fail(fixtureName, label, 'sessions not ordered waiting, working, shell, idle');
        }
        if (fixtureName === 'SESS_MANY' && !W.more.test(html)) fail(fixtureName, label, 'sessions dropped silently');
        if (html.indexOf('screen-frame fluid') === -1) fail(fixtureName, label, 'Claude Sessions must be fluid');
      }

      // GPUs: each fixture says what it is; power is never sold as more than it is.
      if (sid === 'gpus') {
        const want = W.gpus[fixtureName];
        if (want && !has(W, html, want)) fail(fixtureName, label, 'missing "' + want + '"');
        if (fixtureName === 'GPU_HOUSE_STALE_EMPTY' && !has(W, html, 'TELEMETRY STALE')) fail(fixtureName, label, 'stale banner missing over an empty body');
        if (fixtureName === 'FULL' && !has(W, html, 'W NOW')) fail(fixtureName, label, 'no W NOW total');
        if (fixtureName === 'GPU_HOUSE_ONE_OFFLINE' && has(W, html, 'W NOW')) fail(fixtureName, label, 'subtotal sold as W NOW');
        if (fixtureName === 'GPU_HOUSE_NONE' && / W( |<|$)/.test(html.replace(/GPUS/g, ''))) fail(fixtureName, label, 'power shown for no GPUs');
        if (fixtureName === 'GPU_HOUSE_STALE' && !has(W, html, W.gpuWord('critical'))) fail(fixtureName, label, 'cached CRITICAL word lost');
        if (fixtureName === 'GPU_HOUSE_SPARSE' && (/>\s*0%\s*</.test(html) || /NaN/.test(html))) fail(fixtureName, label, 'missing value shown as 0% or NaN');
        if (fixtureName === 'GPU_HOUSE_MANY' && !W.more.test(html)) fail(fixtureName, label, 'GPUs dropped silently');
        if (html.indexOf('screen-frame fluid') === -1) fail(fixtureName, label, 'GPUs must be fluid');
        // Memory temperature: a second line in the full layout only, bounded, never "MEM --".
        const strip = layoutOf(html) === 'strip';
        const memN = W.memCount ? W.memCount(html) : (html.match(/MEM /g) || []).length;
        const memHas = function (t) { return W.memHas ? W.memHas(html, t) : html.indexOf('MEM ' + t + '&deg;') !== -1; };
        if (strip && memN) fail(fixtureName, label, 'MEM line in the strip layout');
        if (/MEM --|MEM NaN|MEM undefined/.test(html)) fail(fixtureName, label, 'MEM shown without a value');
        if (!strip && fixtureName === 'GPU_HOUSE' && !memHas(84)) fail(fixtureName, label, 'MEM 84 missing');
        if (!strip && fixtureName === 'GPU_HOUSE_MEM_EDGE') {
          if (!memHas(200) || !memHas(-50)) fail(fixtureName, label, 'edge MEM values not rounded');
          if (memHas(1000000000) || memHas(-80) || memHas(84)) fail(fixtureName, label, 'out-of-range or string MEM shown');
        }
        if (fixtureName === 'GPU_HOUSE_HOSTILE' && memN) fail(fixtureName, label, 'string MEM shown');
        if (!strip && fixtureName === 'GPU_HOUSE_MEM_NULL' && memN !== 1) {
          fail(fixtureName, label, 'a missing memory temperature drew a MEM line');
        }
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
const PAYLOAD = '<video src=x onerror=alert(1)>';
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
// Every Kiosk renderer, every fixture, every shape (strip, the landscape range, other).
[246, 576, 600, 683, 770, 1200].forEach(function (h) {
  setFrameH(h);
  Object.keys(FIX).forEach(function (fx) {
    metrics = FIX[fx];
    REGISTRY.forEach(function (entry) {
      const colors = FAMILIES[entry.family][entry.variant];
      entry.screens.filter(function (x) { return x.id.indexOf('screen') !== 0; }).forEach(function (x) {
        const label = 'h=' + h + ' ' + entry.family + '/' + entry.variant + ' ' + x.id;
        let html;
        try { html = x.fn(colors); } catch (e) { fail(fx, label, 'threw ' + e.message); return; }
        const dirty = html.match(/undefined|NaN|\[object Object\]/);
        if (dirty) fail(fx, label, 'output contains ' + dirty[0]);
        const px = layoutPxHits(html);
        if (px.length) fail(fx, label, 'layout px -- ' + px.slice(0, 4).join(' '));
        if (/HOSTILE$/.test(fx)) {
          const leak = leakReason(x.fn.name, html);
          if (leak) fail(fx, label, 'unescaped metric reached output -- ' + leak);
        }
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
KIOSK_THEMES.forEach(function (fv) {
  if (!wordsFor(fv[0], fv[1])) fail('REGISTRY', fv.join('/'), 'Kiosk theme without KIOSK_WORDS in the harness');
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
    KIOSK_THEMES.forEach(function (fv) {
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
          const fn = plan.empty ? plan.notice : plan.list[0].fn;
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
  KIOSK_THEMES.filter(function (fv) { return screenRenderer('gpus', fv[0], fv[1]) && wordsFor(fv[0], fv[1]); })
    .map(function (fv) { return [fv[0], fv[1], screenRenderer('gpus', fv[0], fv[1]).fn]; }).forEach(function (t) {
    activeFamily = t[0];
    const W = wordsFor(t[0], t[1]);
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
        if (W.lit ? !litOnly(containers(html, 'data-state')[0] || '', W.gpuWord(st), W.legend)
                  : !new RegExp('>\\s*' + W.gpuWord(st) + '\\s*<').test(html)) fail('GPUS', st + ' ' + where, 'state word missing');
        if ((st === 'offline' || st === 'unreadable') && !has(W, html, 'SEEN')) fail('GPUS', st + ' ' + where, 'no SEEN age on a cached row');
      });
      ['GPU_HOUSE', 'GPU_HOUSE_TIES', 'GPU_HOUSE_MANY'].forEach(function (name) {
        metrics = FIX[name];
        const html = t[2](colors);
        const got = (html.match(/data-gpu-row="([^"]*)"/g) || []).map(function (x) { return x.slice(14, -1); });
        let want = expected(FIX[name]);
        if (W.gpuGrouped) {   // grouped by host, groups in order of their first (worst) row
          const hostOf = function (k) { return k.slice(0, k.lastIndexOf('|')); };
          const order = [];
          want.forEach(function (k) { if (order.indexOf(hostOf(k)) === -1) order.push(hostOf(k)); });
          want = order.reduce(function (a, h) { return a.concat(want.filter(function (k) { return hostOf(k) === h; })); }, []);
        }
        if (!got.length) fail('GPUS', name + ' ' + where, 'no rows rendered');
        if (got.join() !== want.slice(0, got.length).join()) fail('GPUS', name + ' ' + where, 'order ' + got.join() + ' != ' + want.join());
        const more = W.more.exec(html);
        if (got.length < want.length ? !(more && Number(more[1]) === want.length - got.length) : !!more) {
          fail('GPUS', name + ' ' + where, 'MORE ' + (more && more[1]) + ' with ' + got.length + ' of ' + want.length);
        }
      });
      metrics = FIX.GPU_HOUSE_STALE;
      if (!has(W, t[2](colors), 'SEEN')) fail('GPUS', 'stale ' + where, 'stale rows need their age');
      metrics = FIX.GPU_HOUSE_STALE_EMPTY;
      if (!has(W, t[2](colors), 'TELEMETRY STALE')) fail('GPUS', 'stale empty ' + where, 'no stale banner');
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

/* ── KIOSK CORE: what every look shares ── */
(function () {
  const eq = function (what, got, want) {
    if (JSON.stringify(got) !== JSON.stringify(want)) fail('KIOSK CORE', what, JSON.stringify(got) + ' != ' + JSON.stringify(want));
  };
  [[683, 683], [600, 600], [576, 576], [770, 770], [1200, 600], [246, 600], [400, 600]].forEach(function (c) {
    setFrameH(c[0]); eq('kioskH at ' + c[0], kioskH(), c[1]);
    const fluid = bsFrame('x', 'landscape').indexOf('screen-frame fluid') !== -1;
    eq('landscape frame fluid at ' + c[0], fluid, layoutClass() === 'landscape');
  });
  setFrameH(600);
  eq('bsFrame true unchanged', bsFrame('x', true).indexOf('class="screen-frame fluid"') !== -1, true);
  eq('bsFrame look attribute', /data-look="Sci-Fi\/TNG"/.test(bsFrame('x', 'landscape', 'Sci-Fi/TNG')), true);
  // Up and health, from the issue keys.
  metrics = FIX.HL_BUSY;
  const L = kioskLab();
  const host = function (n) { return L.hosts.filter(function (h) { return h.name === n; })[0]; };
  eq('down host', [host('Vesta').up, host('Vesta').health], [false, 'down']);
  eq('gw host', [host('pfSense').up, host('pfSense').health], [false, 'down']);
  eq('api host', [host('Home Assistant').up, host('Home Assistant').health], [true, 'crit']);
  eq('warn host', [host('devbox').up, host('devbox').health, host('devbox').n], [true, 'warn', 2]);
  eq('issues in server order', L.issues.map(function (i) { return i.title; }), FIX.HL_BUSY['homelab.issues'].value.map(function (i) { return i.title; }));
  eq('counts', L.counts, { ok: 0, warn: 4, crit: 3, down: 2, unknown: 0 });
  metrics = FIX.HL_PENDING;
  eq('pending lamps unknown', kioskLab().hosts.map(function (h) { return h.up; }).filter(function (u) { return u !== null; }), []);
  metrics = FIX.HL_UNKNOWN;
  eq('unknown host', [kioskLab().hosts[2].up, kioskLab().hosts[2].health], [null, 'unknown']);
  metrics = FIX.HL_STALE;
  eq('stale keeps lamps', [kioskLab().stale, kioskLab().hosts[0].up], [true, true]);
  // Attention: words, and today's tab colours unchanged.
  bsSkin(__HARNESS.skins[0]);
  const TOS = __HARNESS.skins[0];
  const ATT = { FULL: { lab: null, sessions: 'warn', gpus: null }, KIOSK_CALM: { lab: null, sessions: null, gpus: null },
                HL_RED: { lab: 'crit', sessions: 'warn', gpus: null }, HL_YELLOW: { lab: 'warn', sessions: 'warn', gpus: null },
                HL_STALE: { lab: 'warn', sessions: 'warn', gpus: null }, SESS_OFFLINE: { lab: null, sessions: 'warn', gpus: null },
                GPU_HOUSE: { lab: null, sessions: 'warn', gpus: 'crit' }, GPU_HOUSE_STALE: { lab: null, sessions: 'warn', gpus: 'warn' },
                HL_UNCONFIGURED: { lab: null, sessions: 'warn', gpus: null } };
  Object.keys(ATT).forEach(function (fx) {
    metrics = FIX[fx];
    const a = kioskAttention();
    eq('attention ' + fx, { lab: a.lab, sessions: a.sessions, gpus: a.gpus }, ATT[fx]);
    const c = bsTabAttention();
    const col = function (w) { return w === 'crit' ? TOS.crit : w === 'warn' ? TOS.warn : null; };
    eq('tab colours ' + fx, { lab: c.lab, sessions: c.sessions, gpus: c.gpus },
       { lab: col(ATT[fx].lab), sessions: col(ATT[fx].sessions), gpus: col(ATT[fx].gpus) });
  });
  // The worst state counts only the plan's live screens.
  const tabs = function (ids) {
    return ids.map(function (id) { const s = SCREEN_SPEC.screens[id]; return { id: id, label: s.label, color: s.color, built: s.built, live: s.built }; });
  };
  metrics = FIX.FULL;
  setTabPlan(tabs(['lab', 'sessions', 'gpus'])); eq('worst FULL', kioskWorst(), 'warn');
  setTabPlan(tabs(['lab', 'gpus'])); eq('worst FULL without Sessions', kioskWorst(), 'ok');
  metrics = FIX.HL_RED; setTabPlan(tabs(['sessions', 'lab'])); eq('worst HL_RED', kioskWorst(), 'crit');
  metrics = FIX.KIOSK_CALM; setTabPlan(null); eq('worst calm', kioskWorst(), 'ok');
  // Menu items follow the plan's order, with attention.
  metrics = FIX.HL_RED; setTabPlan(tabs(['gpus', 'overview', 'lab']));
  eq('menu', kioskMenu('lab').map(function (t) { return [t.key, t.live, t.built, t.active, t.att, t.screen]; }),
     [['gpus', true, true, false, null, 'gpus'], ['overview', false, false, false, null, null], ['lab', true, true, true, 'crit', 'lab']]);
  setTabPlan(null); metrics = FIX.FULL;
  eq('clock', kioskClock(), { hm: '14:03', day: 'SATURDAY', date: 'OCTOBER 24', short: 'SAT 24 OCT', year: 2026 });
  // Padding counts the raw text, then escapes.
  eq('kpad', kpad('<b>', 5), '&lt;b&gt;  ');
  eq('kpad cut', kpad('abcdef', 3), 'abc');
  eq('klpad', klpad('7', 3), '  7');
  eq('kpad code points', kpad('92°C→', 6), '92°C→ ');
  eq('fit over', kioskFit(15, 9, 8), { shown: 8, more: 7 });
  eq('fit exact', kioskFit(8, 9, 8), { shown: 8, more: 0 });
  eq('fit sessions', kioskFit(6, 5, 5), { shown: 5, more: 1 });
  eq('fit empty', kioskFit(0, 5, 4), { shown: 0, more: 0 });
  // Renderer metadata: today's Kiosk renderers stay fluid, plain true.
  eq('TOS fluid', screenRenderer('lab', 'Sci-Fi', 'TOS').fluid, true);
  eq('plan notice', typeof screenPlan({ mode: 'kiosk', screens: [], family: 'Sci-Fi', variant: 'TOS' }).notice, 'function');
  // Look skins from any base (phase 2): frozen, cached by id, the base never written.
  const SCAN = __HARNESS.allSkins()[4];
  const v1 = kioskSkinFrom('t-core', SCAN, { kHour: '#123456' });
  eq('skinFrom frozen', Object.isFrozen(v1), true);
  eq('skinFrom cached', kioskSkinFrom('t-core', SCAN, { kHour: '#123456' }) === v1, true);
  eq('skinFrom selects', bsS() === v1, true);
  eq('skinFrom values', [v1.kHour, v1.key, SCAN.kHour], ['#123456', 'scan', undefined]);
  // The scaling alert list.
  const lay = function (n, h) { const L = kioskIssueLayout(n, h); return [L.cols, L.rows, L.big, L.shown, L.more]; };
  eq('issues 3', lay(3, 300), [1, 3, true, 3, 0]);
  eq('issues 3 rowH', kioskIssueLayout(3, 300).rowH, 76);
  eq('issues 15', lay(15, 284), [2, 8, false, 15, 0]);
  eq('issues 16', lay(16, 284), [2, 8, false, 16, 0]);
  eq('issues 20', lay(20, 284), [2, 9, false, 17, 3]);
  eq('issues 40 tall', lay(40, 480), [2, 16, false, 31, 9]);
  eq('issues 0', lay(0, 284), [1, 1, true, 0, 0]);
  // Host grids: sized to the names when they fit, equal columns when they would not.
  eq('cols fit', kioskCols(['atlas', 'vesta', 'home assistant'], 146, 12.5, 830), 'repeat(3,1fr)');
  eq('cols long', kioskCols(['build-runner-eleven', 'storage-array-main', 'backup-target-two'], 146, 12.5, 830), 'repeat(3,minmax(0,1fr))');
  // A skin may say how GPU states are coloured; today's skins do not.
  kioskSkinFrom('t-gpu', __HARNESS.skins[0], { gpuState: function () { return '#abcabc'; } });
  eq('gpuState hook', gpuStateColor('busy'), '#abcabc');
  bsSkin(__HARNESS.skins[0]);
  eq('gpuState default', gpuStateColor('busy'), __HARNESS.skins[0].a4);
  // Distro roles.
  ['Arch', 'Ubuntu', 'openSUSE', 'Mandriva'].forEach(function (v) {
    ['warnA', 'crit', 'ok', 'off', 'ghost', 'ghostText'].forEach(function (k) {
      if (!/^#[0-9a-f]{6}$/i.test(String(__HARNESS.distroSkins[v][k]))) fail('KIOSK CORE', v, 'distro role ' + k + ' missing');
    });
  });
  eq('Arch roles', ['warnA', 'crit', 'ok', 'off', 'ghost', 'ghostText'].map(function (k) { return __HARNESS.distroSkins.Arch[k]; }),
     ['#e5c07b', '#e06c75', '#7fb87f', '#13202a', '#1c2a35', '#2e4352']);
  setFrameH(600);
})();

/* ── LOOKS: what every new Kiosk look must do (spec "Rules every look follows",
   "Order and overflow", "Up and health", "Skins and theme switching"). Driven
   by the data-* markers the looks carry: data-status (the frame's worst state),
   data-host/-up/-health, data-alert, data-session, data-gpu-row. ── */
(function () {
  const attrs = function (html, name) {
    const re = new RegExp(name + '="([^"]*)"', 'g'), out = [];
    let mm;
    while ((mm = re.exec(html))) out.push(mm[1]);
    return out;
  };
  const tabs = function (ids) {
    return ids.map(function (id) { const s = SCREEN_SPEC.screens[id]; return { id: id, label: s.label, color: s.color, built: s.built, live: s.built }; });
  };
  const SKIN_SNAP = JSON.stringify(__HARNESS.allSkins());
  // JSON drops functions: their identities are compared too.
  const fnSnap = function () {
    const out = [];
    __HARNESS.allSkins().forEach(function (sk) { Object.keys(sk).forEach(function (k) { if (typeof sk[k] === 'function') out.push(sk[k]); }); });
    return out;
  };
  const SKIN_FNS = fnSnap();
  KIOSK_THEMES.forEach(function (fv) {
    const key = fv.join('/'), W = wordsFor(fv[0], fv[1]);
    if (!W || !W.status) return;          // TOS and Claude: checked above, unchanged
    const colors = FAMILIES[fv[0]][fv[1]];
    const R = function (id) { return screenRenderer(id, fv[0], fv[1]).fn; };
    activeFamily = fv[0];
    // The frame's status: the worst state of the plan's live screens.
    [['KIOSK_CALM', ['lab', 'sessions', 'gpus'], 'ok'], ['FULL', ['lab', 'sessions', 'gpus'], 'warn'],
     ['FULL', ['lab', 'gpus'], 'ok'], ['HL_RED', ['sessions', 'lab'], 'crit'], ['GPU_HOUSE', ['gpus'], 'crit'],
     ['HL_YELLOW', ['lab'], 'warn']].forEach(function (c) {
      metrics = FIX[c[0]]; setTabPlan(tabs(c[1]));
      ['lab', 'sessions', 'gpus'].forEach(function (id) {
        const html = R(id)(colors);
        const st = attrs(html, 'data-status')[0];
        if (st !== c[2]) fail('LOOKS', key + ' ' + id + ' ' + c[0] + ' [' + c[1] + ']', 'status ' + st + ' != ' + c[2]);
        if (html.indexOf(W.status[c[2]]) === -1) fail('LOOKS', key + ' ' + id + ' ' + c[0], 'status colour ' + W.status[c[2]] + ' missing');
      });
    });
    setTabPlan(null);
    [576, 600, 683, 770].forEach(function (h) {
      setFrameH(h);
      const where = key + ' h=' + h;
      // Up and health per host.
      ['HL_BUSY', 'HL_PENDING', 'HL_UNKNOWN', 'HL_STALE', 'FULL'].forEach(function (fx) {
        metrics = FIX[fx];
        const html = R('lab')(colors);
        const want = kioskLab().hosts;
        const got = attrs(html, 'data-host').map(function (n, i) { return [n, attrs(html, 'data-up')[i], attrs(html, 'data-health')[i]]; });
        // In the look's own arrangement (a column-major grid reads down): compare by name.
        const byName = {};
        want.forEach(function (x) { byName[esc(x.name)] = [esc(x.name), String(x.up), x.health]; });
        const exp = got.map(function (g) { return byName[g[0]] || ['?']; });
        if (JSON.stringify(got) !== JSON.stringify(exp)) fail('LOOKS', where + ' ' + fx, 'hosts ' + JSON.stringify(got) + ' != ' + JSON.stringify(exp));
        if (W.hostCap !== undefined ? got.length < Math.min(W.hostCap, want.length) : got.length !== want.length) {
          fail('LOOKS', where + ' ' + fx, 'shows ' + got.length + ' of ' + want.length + ' hosts');
        }
      });
      // Alerts: the server's order, at least 8 at 576, the rest counted.
      if (!W.alertsByHost) {
        metrics = FIX.HL_BUSY;
        const html = R('lab')(colors);
        const got = attrs(html, 'data-alert').map(Number);
        const more = W.more.exec(html);
        if (got.join() !== got.map(function (_, i) { return i; }).join()) fail('LOOKS', where, 'alerts out of order ' + got.join());
        if (got.length < 8) fail('LOOKS', where, 'only ' + got.length + ' alerts shown');
        const hidden = 15 - got.length;
        if (hidden ? !(more && Number(more[1]) === hidden) : !!more) fail('LOOKS', where, 'MORE ' + (more && more[1]) + ' for ' + hidden + ' hidden');
      }
      // Sessions: 5 at least, the rest counted.
      [['SESS_BUSY', 6], ['SESS_MANY', 14]].forEach(function (c) {
        metrics = FIX[c[0]];
        const html = R('sessions')(colors);
        const got = attrs(html, 'data-session').map(Number);
        const more = W.more.exec(html);
        if (got.length < Math.min(5, c[1])) fail('LOOKS', where + ' ' + c[0], 'only ' + got.length + ' sessions');
        if (got.join() !== got.map(function (_, i) { return i; }).join()) fail('LOOKS', where + ' ' + c[0], 'sessions out of order');
        const hidden = c[1] - got.length;
        if (hidden ? !(more && Number(more[1]) === hidden) : !!more) fail('LOOKS', where + ' ' + c[0], 'MORE ' + (more && more[1]) + ' for ' + hidden + ' hidden');
      });
      // Phase 2 busy cases, in every new look: twelve long-named hosts with fifteen
      // stale alerts; seven sessions all with messages; eleven stale GPUs.
      {
        metrics = FIX.HL_LONG12;
        const html = R('lab')(colors);
        const hosts = attrs(html, 'data-host');
        if (W.hostCap !== undefined ? hosts.length < 12 : hosts.length !== 12) fail('LOOKS', where + ' HL_LONG12', 'shows ' + hosts.length + ' of 12 hosts');
        if (!W.alertsByHost) {
          const got = attrs(html, 'data-alert').map(Number), more = W.more.exec(html);
          if (got.length < 8 || got.join() !== got.map(function (_, i) { return i; }).join()) fail('LOOKS', where + ' HL_LONG12', 'alerts ' + got.join());
          const hidden = 15 - got.length;
          if (hidden ? !(more && Number(more[1]) === hidden) : !!more) fail('LOOKS', where + ' HL_LONG12', 'MORE ' + (more && more[1]) + ' for ' + hidden);
        }
        metrics = FIX.SESS_MSG7;
        const sh = R('sessions')(colors), sg = attrs(sh, 'data-session').map(Number), sm = W.more.exec(sh);
        if (sg.length < 5 || sg.join() !== sg.map(function (_, i) { return i; }).join()) fail('LOOKS', where + ' SESS_MSG7', 'sessions ' + sg.join());
        if (7 - sg.length ? !(sm && Number(sm[1]) === 7 - sg.length) : !!sm) fail('LOOKS', where + ' SESS_MSG7', 'MORE ' + (sm && sm[1]));
        metrics = FIX.GPU_HOUSE_STALE11;
        const gh = R('gpus')(colors), gg = attrs(gh, 'data-gpu-row'), gm = W.more.exec(gh);
        if (gg.length < 8) fail('LOOKS', where + ' GPU_HOUSE_STALE11', 'only ' + gg.length + ' GPUs');
        if (11 - gg.length ? !(gm && Number(gm[1]) === 11 - gg.length) : !!gm) fail('LOOKS', where + ' GPU_HOUSE_STALE11', 'MORE ' + (gm && gm[1]));
      }
      // A lit look: each session's and GPU's own legend lights its state, and only that.
      if (W.lit) {
        const SW = { waiting: 'INPUT', busy: 'WORK', shell: 'SHELL', idle: 'IDLE' };
        ['FULL', 'SESS_BUSY', 'SESS_MSG7'].forEach(function (fx) {
          metrics = FIX[fx];
          const list = sessData().list, html = R('sessions')(colors);
          html.split('data-session="').slice(1).forEach(function (r, i) {
            const box = containers(r, 'data-state')[0] || '';
            if (!litOnly(box, SW[list[i].state] || 'IDLE', ['INPUT', 'WORK', 'SHELL', 'IDLE'])) fail('LOOKS', where + ' ' + fx + ' session ' + i, 'state legend wrong');
          });
        });
        ['GPU_HOUSE_BUSY', 'GPU_HOUSE_BUSY9', 'GPU_HOUSE_STALE11'].forEach(function (fx) {
          metrics = FIX[fx];
          const rows = gpuHouseData().rows, html = R('gpus')(colors);
          html.split('data-gpu-row="').slice(1).forEach(function (r, i) {
            const box = containers(r, 'data-state')[0] || '';
            if (!W.gpuLit(rows[i].state).some(function (w) { return litOnly(box, w, W.legend.concat(Object.values(GPU_WORDS))); })) fail('LOOKS', where + ' ' + fx + ' gpu ' + i, 'state not lit alone');
          });
        });
      }
      // No wasted space (the Go's 683, and 770): a taller frame shows more sessions, not
      // the design height's five over a blank band.
      if (h >= 683) {
        const sl = FIX.SESS_MANY['sessions.list'];
        metrics = Object.assign({}, FIX.SESS_MANY, { 'sessions.list': Object.assign({}, sl, { value: sl.value.map(function (x, i) {
          return Object.assign({}, x, i < 2 ? { state: 'waiting', message: 'Claude is waiting for your input' } : { state: 'idle', message: '' }); }) }) });
        const got = attrs(R('sessions')(colors), 'data-session').length;
        if (got < (h >= 770 ? (W.tallSess770 || 8) : (W.tallSess683 || 6))) fail('LOOKS', where + ' SESS_MANY', 'only ' + got + ' sessions in a tall frame');
      }
      // GPUs: 8 cards at least.
      [['GPU_HOUSE_BUSY', 8], ['GPU_HOUSE_BUSY9', 9]].forEach(function (c) {
        metrics = FIX[c[0]];
        const html = R('gpus')(colors);
        const got = attrs(html, 'data-gpu-row');
        const more = W.more.exec(html);
        if (got.length < 8) fail('LOOKS', where + ' ' + c[0], 'only ' + got.length + ' GPUs');
        const hidden = c[1] - got.length;
        if (hidden ? !(more && Number(more[1]) === hidden) : !!more) fail('LOOKS', where + ' ' + c[0], 'MORE ' + (more && more[1]) + ' for ' + hidden + ' hidden');
      });
    });
    // Codex build r1: twelve hosts at 576 all show whatever the issue count; eight GPUs
    // on five hosts all show; every cached GPU row carries its age; the LOAD panel never
    // says "all in the table" when the table hides some.
    setFrameH(576);
    [0, 1, 4, 6, 15].forEach(function (k) {
      const names = Array.from({ length: 12 }, function (_, i) { return 'host-' + (i + 1); });
      const iss = Array.from({ length: k }, function (_, i) {
        return { host: names[i % 12], key: 'k' + i, severity: i ? 'warn' : 'crit', title: 'Issue ' + i, detail: '', since: Date.now() / 1000 - 600 + i };
      });
      metrics = Object.assign({}, FIX.HL_BUSY, {
        'homelab.issues': Object.assign({}, FIX.HL_BUSY['homelab.issues'], { value: iss }),
        'homelab.hosts': Object.assign({}, FIX.HL_BUSY['homelab.hosts'], { value: names.map(function (n) {
          return { name: n, state: iss.some(function (i) { return i.host === n; }) ? 'warn' : 'ok' }; }) }) });
      const got = attrs(R('lab')(colors), 'data-host').length;
      if (got !== 12) fail('LOOKS', key + ' h=576 12 hosts ' + k + ' issues', 'shows ' + got + ' hosts');
    });
    metrics = Object.assign({}, FIX.GPU_HOUSE_BUSY, { 'homelab.gpus': Object.assign({}, FIX.GPU_HOUSE_BUSY['homelab.gpus'], {
      value: FIX.GPU_HOUSE_BUSY['homelab.gpus'].value.map(function (r, i) { return Object.assign({}, r, { host: 'box' + (i % 5) }); }) }) });
    if (attrs(R('gpus')(colors), 'data-gpu-row').length !== 8) fail('LOOKS', key + ' h=576', '8 GPUs on 5 hosts do not all show');
    // Codex build r2: stale data (a banner) with nine GPUs on four hosts, and eight GPUs on
    // eight hosts (eight headings): still eight rows, and the rest counted exactly.
    [[FIX.GPU_HOUSE_BUSY9, function (r) { return r; }, { published_at: Date.now() / 1000 - 1000 }, 9],
     [FIX.GPU_HOUSE_BUSY, function (r, i) { return Object.assign({}, r, { host: 'node' + i }); }, {}, 8]].forEach(function (c, ci) {
      const g = c[0]['homelab.gpus'];
      metrics = Object.assign({}, c[0], { 'homelab.gpus': Object.assign({}, g, { value: g.value.map(c[1]), extra: Object.assign({}, g.extra, c[2]) }) });
      const html = R('gpus')(colors);
      const got = attrs(html, 'data-gpu-row').length, more = W.more.exec(html);
      if (got < 8) fail('LOOKS', key + ' h=576 GPU case ' + ci, 'only ' + got + ' GPUs');
      if (c[3] - got ? !(more && Number(more[1]) === c[3] - got) : !!more) fail('LOOKS', key + ' h=576 GPU case ' + ci, 'MORE ' + (more && more[1]));
      // Every row still says which host it is on.
      html.split('data-gpu-row="').slice(1).forEach(function (r) {
        const host = r.slice(0, r.indexOf('|'));
        const low = html.toLowerCase(), h = host.toLowerCase();
        if (r.slice(r.indexOf('"') + 1).toLowerCase().indexOf(h) === -1 && low.indexOf('>' + h) === -1) fail('LOOKS', key + ' GPU case ' + ci, 'row without its host ' + host);
      });
    });
    metrics = Object.assign({}, FIX.GPU_HOUSE_BUSY, { 'homelab.gpus': Object.assign({}, FIX.GPU_HOUSE_BUSY['homelab.gpus'], {
      value: FIX.GPU_HOUSE_BUSY['homelab.gpus'].value.map(function (r) { return Object.assign({}, r, { state: 'offline', seen_at: Date.now() / 1000 - 90000 }); }) }) });
    {
      const html = R('gpus')(colors);
      const rows = html.split('data-gpu-row="').slice(1);
      rows.forEach(function (r, i) {
        // The row's own markup, up to the next row.
        if (!/seen/i.test(r)) fail('LOOKS', key + ' h=576 offline row ' + i, 'cached row without its age');
      });
    }
    // On-device (Go, 2026-10-24): a server name longer than the mockup's ran under the
    // first tab. The header line stays within the date line's 15 columns.
    if (W.alertsByHost) {
      [['atlas', 'chiketi · atlas'], ['build-runner-eleven', 'build-runner-eleven']].forEach(function (c) {
        metrics = Object.assign({}, FIX.FULL, { 'sys.hostname': Object.assign({}, FIX.FULL['sys.hostname'], { value: c[0] }) });
        const html = R('lab')(colors);
        const m2 = /<div data-hostline style="([^"]*)">([^<]*)</.exec(html);
        if (!m2 || m2[2] !== c[1]) fail('LOOKS', key + ' host line ' + c[0], 'got ' + (m2 && m2[2]));
        else if (c[0].length > 6 && !/max-width:[^;]*cqw;.*text-overflow:ellipsis/.test(m2[1])) fail('LOOKS', key + ' host line', 'long name not bounded');
      });
    }
    metrics = FIX.GPU_HOUSE_MANY;
    { const html = R('gpus')(colors);
      if (/all in the table/.test(html) && attrs(html, 'data-gpu-row').length < 12) fail('LOOKS', key + ' h=576', 'says all in the table while the table hides GPUs'); }
    setFrameH(600);
    // Theme switching: after a Self Scanlines screen (glass, raster) and after
    // another look, each screen draws exactly what it draws fresh.
    metrics = FIX.HL_BUSY;
    ['lab', 'sessions', 'gpus'].forEach(function (id) {
      __HARNESS.resetState(); seedRandom(1);
      const fresh = R(id)(colors);
      scanScreen1(FAMILIES.Vintage.Scanlines); sfTosHomelab(FAMILIES['Sci-Fi'].TOS);
      // and after the other Kiosk looks (TNG, both Scanlines rasters, VFD)
      tngHomelab(FAMILIES['Sci-Fi'].TNG); scanGpus(FAMILIES.Vintage.Scanlines); scanHomelab(FAMILIES.Vintage.Scanlines);
      if (typeof vfdHomelab === 'function') vfdHomelab(FAMILIES.Vintage.VFD);
      __HARNESS.resetState(); seedRandom(1);
      if (R(id)(colors) !== fresh) fail('LOOKS', key + ' ' + id, 'differs after Scanlines and TOS screens');
      R(id)(colors);
      __HARNESS.resetState(); seedRandom(1);
      if (scanScreen1(FAMILIES.Vintage.Scanlines) !== (function () { __HARNESS.resetState(); seedRandom(1); return scanScreen1(FAMILIES.Vintage.Scanlines); })()) {
        fail('LOOKS', key + ' ' + id, 'Scanlines differs after this look');
      }
    });
    // An empty plan right after choosing the theme: the look's own notice.
    setTabPlan([]);
    const notice = screenPlan({ mode: 'kiosk', screens: [], family: fv[0], variant: fv[1] }).notice;
    const nh = notice(colors);
    if (nh.indexOf('NO SCREENS TO SHOW') === -1 || nh.indexOf('data-look="' + key + '"') === -1) fail('LOOKS', key, 'notice is not the look\'s own');
    setTabPlan(null);
  });
  if (JSON.stringify(__HARNESS.allSkins()) !== SKIN_SNAP) fail('LOOKS', 'skins', 'a shared skin object was written');
  { const now = fnSnap(); if (now.length !== SKIN_FNS.length || now.some(function (f, i) { return f !== SKIN_FNS[i]; })) fail('LOOKS', 'skins', 'a shared skin function was replaced'); }
  metrics = FIX.FULL;
})();

/* ── Golden: today's screens stay byte-identical ─────────────────────────
   Every Self renderer of every theme and today's Kiosk renderers (TOS, Claude),
   for every fixture, at three heights, with and without a tab plan. A new key is
   only added by GOLDEN=update; a changed hash for an existing key always fails.
   Deterministic: frozen clock, seeded random reset per render, no history. */
(function () {
  const file = path.join(__dirname, 'golden.json');
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const got = {};
  const PLAN3 = ['lab', 'sessions', 'gpus'].map(function (id) {
    const s = SCREEN_SPEC.screens[id];
    return { id: id, label: s.label, color: s.color, built: s.built, live: true };
  });
  const GOLDEN_KIOSK = ['Sci-Fi/TOS', 'Others/Claude'];
  const render = function (fn, colors) {
    __HARNESS.resetState();
    seedRandom(1);
    return fn(colors);
  };
  for (const fx of Object.keys(FIX)) {
    metrics = FIX[fx];
    [600, 683, 246].forEach(function (h) {
      setFrameH(h);
      [['none', null], ['plan3', PLAN3]].forEach(function (pl) {
        setTabPlan(pl[1]);
        THEME_LIST.forEach(function (fv) {
          const key = fv[0] + '/' + fv[1];
          activeFamily = fv[0];
          const colors = FAMILIES[fv[0]][fv[1]];
          const ids = SCREEN_SPEC.modes.self.screens.concat(GOLDEN_KIOSK.indexOf(key) !== -1 ? ['lab', 'sessions', 'gpus'] : []);
          ids.forEach(function (id) {
            const r = screenRenderer(id, fv[0], fv[1]);
            if (!r) return;
            if (id.indexOf('screen') === 0 && pl[0] !== 'none') return;   // Self screens draw no tabs
            let html;
            try { html = render(r.fn, colors); } catch (e) { html = 'THREW ' + e.message; }
            got[[fx, h, pl[0], key, id].join('|')] = crypto.createHash('sha1').update(html).digest('hex').slice(0, 16);
          });
        });
        if (pl[0] === 'plan3') {
          [['Sci-Fi', 'TOS'], ['Others', 'Claude']].forEach(function (fv) {
            activeFamily = fv[0];
            got[[fx, h, pl[0], fv.join('/'), 'notice'].join('|')] =
              crypto.createHash('sha1').update(render(kioskNotice, FAMILIES[fv[0]][fv[1]])).digest('hex').slice(0, 16);
          });
        }
      });
    });
  }
  setTabPlan(null); setFrameH(600); metrics = FIX.FULL;
  if (process.env.GOLDEN === 'update') {
    const merged = Object.assign({}, got);
    Object.keys(old).forEach(function (k) { if (k in got && old[k] !== got[k]) merged[k] = old[k]; });
    fs.writeFileSync(file, JSON.stringify(merged, Object.keys(merged).sort(), 0).replace(/,"/g, ',\n"') + '\n');
    console.log('golden: ' + Object.keys(got).filter(function (k) { return !(k in old); }).length + ' keys added');
  }
  Object.keys(got).forEach(function (k) {
    if (k in old && old[k] !== got[k]) fail('GOLDEN', k, 'output changed from the golden render');
    else if (!(k in old) && process.env.GOLDEN !== 'update') fail('GOLDEN', k, 'no golden hash (run GOLDEN=update for new keys only)');
  });
})();

if (failures.length) {
  failures.forEach(function (f) { console.error(f); });
  console.error('\n' + failures.length + ' renderer failures');
  process.exit(1);
}
console.log('renderer harness OK');
