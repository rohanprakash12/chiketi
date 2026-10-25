/* ── kiosk_looks.js: what every Kiosk look shares ─────────────────────────
 * The Kiosk screens (Home Lab, Sessions, GPUs) are drawn in each theme's own
 * idiom (kiosk_scifi.js, kiosk_terminal.js). They all read the same things from
 * here, so a state means the same on every look:
 *   kioskH()          the height layouts use: the frame's, or 600 when the shape is
 *                     not landscape (the look is then letterboxed in 1024 x 600);
 *   kioskAttention()  each screen's status (today's tab-attention rule), and
 *   kioskWorst()      the worst of it over the plan's live screens;
 *   kioskLab/Sess/Gpus()  the data, with up and health worked out per host;
 *   kioskMenu()       the menu, from the plan (order, live, planned, attention).
 * server.py appends this file (and the looks) to screen_functions.js. */

/* gq() in exact units: n/1024 of the width, unrounded. gq() keeps three decimals
   (today's screens are pinned to that), which draws 22 as 21.9955 px and moves
   text anti-aliasing off the agreed mockups. */
function kq(n) { return (n * 100 / 1024) + 'cqw'; }

function kioskH() { return layoutClass() === 'landscape' ? frameH() : 600; }

/* Each Kiosk screen's status, as a word: today's inputs and precedence. */
function kioskAttention() {
  const d = sessData();
  const lab = hlConfigured() ? hlData().mode : null;
  let gpus = null;
  if (hlConfigured()) {
    const S = bsS();
    const col = gpuStatusColor(gpuHouseData());
    gpus = col === S.crit ? 'crit' : col === S.warn ? 'warn' : null;
  }
  return {
    lab: lab === 'crit' ? 'crit' : (lab === 'warn' || lab === 'stale') ? 'warn' : null,
    sessions: (d.status === 'offline' || d.list.some(function (s) { return s.state === 'waiting'; })) ? 'warn' : null,
    gpus: gpus,
  };
}

/* The worst status of the screens this display can show (its plan's live tabs):
   an unselected screen's warning does not colour the frame. */
function kioskWorst() {
  const a = kioskAttention();
  const live = bsTabList().filter(function (t) { return t.built; }).map(function (t) { return a[t.key]; });
  return live.indexOf('crit') !== -1 ? 'crit' : live.indexOf('warn') !== -1 ? 'warn' : 'ok';
}

/* The menu, from the plan: every selected screen in the device's order. `built`
   is "this screen exists", `live` is "it is in this display's list" (tappable). */
function kioskMenu(active) {
  const a = kioskAttention();
  return bsTabList().map(function (t) {
    const spec = SCREEN_SPEC.screens[t.key] || {};
    return { key: t.key, label: t.label, built: !!spec.built, live: !!t.built, active: t.key === active,
             att: t.built ? (a[t.key] || null) : null, screen: t.screen };
  });
}
/* The data-tab / data-screen attributes a menu item carries (the display's taps). */
function kioskTabAttrs(t) {
  return ` data-tab="${t.key}"` + (t.screen ? ` data-screen="${t.screen}"` : '');
}

const KIOSK_DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const KIOSK_MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER',
                      'OCTOBER', 'NOVEMBER', 'DECEMBER'];
function kioskClock() {
  const d = new Date();
  const day = KIOSK_DAYS[d.getDay()], mon = KIOSK_MONTHS[d.getMonth()];
  return { hm: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
           day: day, date: mon + ' ' + d.getDate(), short: day.slice(0, 3) + ' ' + d.getDate() + ' ' + mon.slice(0, 3),
           year: d.getFullYear() };
}

/* Home Lab, per host: up (its probe or service is available) and health.
   up is false while an open issue has key down or gw, null (unknown) while Home
   Lab is pending or the host has no result yet. A down host's health is 'down'. */
function kioskLab() {
  const d = hlData();
  const known = d.mode !== 'pending' && d.mode !== 'unconfigured';
  const counts = { ok: 0, warn: 0, crit: 0, down: 0, unknown: 0 };
  const hosts = d.hosts.map(function (h) {
    const name = String(h.name == null ? '' : h.name);
    const mine = d.issues.filter(function (i) { return String(i.host) === name; });
    const state = h.state === 'ok' || h.state === 'warn' || h.state === 'crit' ? h.state : 'unknown';
    const unreachable = mine.some(function (i) { return i.key === 'down' || i.key === 'gw'; });
    const up = !known || state === 'unknown' ? null : !unreachable;
    const health = up === false ? 'down' : up === null ? 'unknown' : state;
    counts[health]++;
    return { name: name, state: state, up: up, health: health, n: mine.length, issues: mine };
  });
  return { mode: d.mode, hosts: hosts, issues: d.issues, counts: counts, checkedAt: d.checkedAt,
           stale: d.mode === 'stale' };
}

/* Sessions, with the counts and feed details the looks print. */
function kioskSess() {
  const d = sessData();
  const ck = m('sessions.checked_at');
  const t = ck.available ? Number(ck.value) : NaN;
  const counts = { waiting: 0, busy: 0, shell: 0, idle: 0 };
  d.list.forEach(function (s) { counts[SESS_ORDER[s.state] !== undefined ? s.state : 'idle']++; });
  return Object.assign({}, d, { counts: counts, waiting: counts.waiting,
    host: ck.extra && ck.extra.host ? String(ck.extra.host) : '',
    checkedAt: isFinite(t) && t > 0 ? t : null });
}
function kioskTok(n) { return typeof n === 'number' && isFinite(n) ? fmtTok(n) : '--'; }

/* GPUs, with the short model name the looks print ("V100", "RTX 3090 TI"). */
function kioskGpus() {
  const d = gpuHouseData();
  const rows = d.rows.map(function (r) {
    const short = r.name ? String(r.name).replace(/^(Tesla|GeForce|NVIDIA)\s+/i, '').replace(/^(GeForce)\s+/i, '')
      .replace(/-PCIE-\d+GB/i, '').toUpperCase() : '--';
    return Object.assign({}, r, { short: short, fresh: gpuFresh(d, r) });
  });
  const n = function (f) { return rows.filter(f).length; };
  return Object.assign({}, d, { rows: rows,
    busy: n(function (r) { return r.state === 'busy'; }),
    hot: n(function (r) { return r.state === 'hot' || r.state === 'throttling' || r.state === 'critical'; }),
    idle: n(function (r) { return r.state === 'idle'; }),
    powerText: gpuPowerText(d), checked: d.pub ? sessAge(d.pub) + ' AGO' : 'NEVER' });
}

/* How many items to show: capAll fit with no "+N MORE" line, capMore fit with
   that line's space reserved (the line never takes an item's slot). */
function kioskFit(n, capAll, capMore) {
  if (n <= capAll) return { shown: n, more: 0 };
  const shown = Math.max(0, Math.min(n, capMore));
  return { shown: shown, more: n - shown };
}

/* Fixed-width columns: pad or cut the raw text by code points, then escape.
   Padding escaped text would count '&lt;' as four columns. */
function kpad(s, n) {
  const a = Array.from(String(s == null ? '' : s));
  return esc(a.length >= n ? a.slice(0, n).join('') : a.join('') + ' '.repeat(n - a.length));
}
function klpad(s, n) {
  const a = Array.from(String(s == null ? '' : s));
  return esc(a.length >= n ? a.slice(0, n).join('') : ' '.repeat(n - a.length) + a.join(''));
}

/* A number or '--', never 0 for a missing reading. */
function kNum(v, digits) {
  const x = gpuFin(v);
  return x === null ? '--' : digits ? x.toFixed(digits) : String(Math.round(x));
}

/* The skin a Kiosk look draws its frame with: a frozen copy of the TOS skin with
   the look's background and font, and no glass. Every look sets it first, so a
   Vintage screen drawn before it cannot lend it a filter or an overlay, and no
   shared skin object is ever written. */
const _kioskSkins = {};
function kioskSkin(key, bg, font) {
  const id = key + '|' + bg + '|' + font;
  if (!_kioskSkins[id]) {
    _kioskSkins[id] = Object.freeze(Object.assign({}, BS_SKIN_TOS, {
      key: key, bg: bg, font: font, defs: '', overlay: '', frameCss: '', contentFilter: '', contentTransform: '' }));
  }
  bsSkin(_kioskSkins[id]);
  return _kioskSkins[id];
}

/* A look's variant of an existing skin (the Retro looks keep their family's glass,
   glow and instruments): a frozen copy with the look's changes, cached by id, so a
   shared skin object is never written and a theme switch cannot leak into it. */
const _kioskVariants = {};
function kioskSkinFrom(id, base, extra) {
  if (!_kioskVariants[id]) _kioskVariants[id] = Object.freeze(Object.assign({}, base, extra || {}));
  bsSkin(_kioskVariants[id]);
  return _kioskVariants[id];
}

/* The alert list that scales with the count: big rows up to 4, then two compact
   columns of up to 8 rows (the design), more rows past 16 alerts in a frame tall
   enough to keep each at least 30 units. With more than fit, the last cell is the
   "+N MORE" line. */
function kioskIssueLayout(n, h) {
  if (n <= 4) return { cols: 1, rows: Math.max(1, n), rowH: Math.min(76, Math.floor(h / Math.max(1, n))), big: true, shown: n, more: 0 };
  let rows = Math.min(8, Math.ceil(Math.min(n, 16) / 2));
  if (n > 16) rows = Math.max(8, Math.min(Math.ceil(n / 2), Math.floor(h / 30)));
  const shown = n > rows * 2 ? rows * 2 - 1 : n;
  return { cols: 2, rows: rows, rowH: Math.floor(h / rows), big: false, shown: shown, more: n - shown };
}

/* Text width, as an upper bound, for the looks' host grids: the advance widths of the
   bundled fonts (Antonio at weight 400, upper case; Share Tech Mono is monospace),
   letter spacing included, counted after upper-casing (which can lengthen a name:
   ß is SS); any character not in the table is charged 1.25 em, more than a fallback
   glyph takes. */
const KIOSK_EM = {
  antonio: {" ":0.241,"!":0.258,"\"":0.363,"#":0.417,"$":0.393,"%":1.063,"&":0.468,"'":0.202,"(":0.273,")":0.273,"*":0.427,"+":0.332,",":0.226,"-":0.34,".":0.26,"/":0.356,"0":0.417,"1":0.417,"2":0.417,"3":0.417,"4":0.417,"5":0.417,"6":0.417,"7":0.417,"8":0.417,"9":0.417,":":0.239,";":0.274,"<":0.356,"=":0.353,">":0.356,"?":0.417,"@":0.743,"A":0.443,"B":0.448,"C":0.448,"D":0.466,"E":0.369,"F":0.365,"G":0.458,"H":0.48,"I":0.242,"J":0.428,"K":0.444,"L":0.339,"M":0.633,"N":0.495,"O":0.461,"P":0.437,"Q":0.461,"R":0.458,"S":0.404,"T":0.307,"U":0.466,"V":0.431,"W":0.654,"X":0.389,"Y":0.404,"Z":0.337,"[":0.307,"\\":0.359,"]":0.307,"^":0.449,"_":0.365,"`":0.198,"{":0.321,"|":0.262,"}":0.321,"~":0.545},
  stm: 0.54,
};
function kioskTextW(text, font, size, ls) {
  return Array.from(String(text == null ? '' : text).toUpperCase()).reduce(function (w, ch) {
    const em = font === 'stm' ? (ch >= ' ' && ch <= '~' ? KIOSK_EM.stm : 1.25)
      : (KIOSK_EM.antonio[ch] !== undefined ? KIOSK_EM.antonio[ch] : 1.25);
    return w + em * size + (ls || 0);
  }, 0);
}
/* A three-column host grid, filled row by row: sized to the names, as the mockups
   (repeat(3,1fr) gives a column with a long name more room), when each column's widest
   row (`widths`, upper bounds from kioskTextW) adds up to no more than `avail`, the
   three tracks' room; otherwise three equal columns with names cut short, so a long
   name can never push the grid off the screen. */
function kioskCols(widths, avail) {
  const need = [0, 1, 2].reduce(function (sum, c) {
    let most = 0;
    widths.forEach(function (w, i) { if (i % 3 === c) most = Math.max(most, w); });
    return sum + most;
  }, 0);
  return need <= avail ? 'repeat(3,1fr)' : 'repeat(3,minmax(0,1fr))';
}

/* The empty-plan notice for a theme: its look's own, else today's. */
function kioskNoticeFor(fam, v) {
  const k = KIOSK_RENDERERS[fam + '/' + v];
  return k && k.notice ? k.notice : kioskNotice;
}
