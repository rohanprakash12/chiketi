/* ── kiosk_scifi.js: the Kiosk screens in TNG (LCARS) and DS9 ──────────────
 * Ports of the agreed v4 mockups. Shared pieces are in kiosk_looks.js. */

/* ── TNG (LCARS) ──────────────────────────────────────────────────────────
 * The top-left elbow and a thin top bar take the worst status of the plan's
 * screens (lilac fine, yellow warning, red alert); the clock is the big readout
 * in the elbow; the sidebar is the menu (no numbers); the bottom bar carries the
 * screen's summary. Reference: v4 prototype tngFrame / tngLabV2 / tngSessionsV2 /
 * tngGpusV2, px there = kq() units here. */
const TNG_K = { orange: '#FF9933', gold: '#FFCC66', tan: '#FFCC99', lilac: '#CC99CC', violet: '#9999FF',
                blue: '#99CCFF', red: '#FF5544', peach: '#FF9966', text: '#FFE8C8', dim: '#B8B0D8',
                plan: '#3d3352', row: '#15131f', track: '#221e30', idle: '#8888AA', grey: '#888888' };
const TNG_STATUS = { ok: '#CC99CC', warn: '#FFCC66', crit: '#FF5544' };
const TNG_LOOK = 'Sci-Fi/TNG';

function tngFrame(active, title, summary, body) {
  const K = TNG_K;
  const worst = kioskWorst(), sc = TNG_STATUS[worst];
  const btns = kioskMenu(active).map(function (t) {
    const bg = t.active ? K.gold : t.att === 'crit' ? K.red : t.att === 'warn' ? K.peach : t.live ? K.lilac : K.plan;
    return `<div${kioskTabAttrs(t)} style="height:${kq(t.built ? 40 : 28)};background:${bg};position:relative;display:flex;` +
        `align-items:flex-end;justify-content:flex-end;padding:0 ${kq(9)} ${kq(3)};color:#000;font-family:Antonio;` +
        `font-weight:600;font-size:${kq(t.built ? 19 : 13)};letter-spacing:.04em;${t.built ? '' : 'opacity:.6'}">` +
      esc(t.label) + (t.active ? `<i style="position:absolute;right:-${kq(12)};top:0;bottom:0;width:${kq(8)};background:${K.gold}"></i>` : '') +
      `</div>`;
  }).join('');
  const D = kioskClock();
  const seg = summary.map(function (x) {
    return `<span style="height:${kq(28)};display:flex;align-items:center;padding:0 ${kq(12)};background:${x[1] || K.lilac};` +
      `color:#000;font-size:${kq(16)};font-weight:600;letter-spacing:.05em;border-left:${kq(4)} solid #000;white-space:nowrap;` +
      `min-width:0;overflow:hidden;text-overflow:ellipsis">${x[0]}</span>`;
  }).join('');
  return bsFrame(`<div data-status="${worst}" style="position:absolute;inset:0;background:#000;font-family:Antonio;color:${K.text};text-transform:uppercase">` +
    `<div style="position:absolute;left:${kq(10)};top:${kq(10)};width:${kq(150)};height:${kq(96)};background:${sc};border-radius:${kq(40)} 0 0 0">` +
      `<i style="position:absolute;right:0;bottom:0;width:${kq(26)};height:${kq(84)};background:#000;border-radius:${kq(18)} 0 0 0"></i>` +
      `<div style="position:absolute;left:${kq(12)};right:${kq(30)};bottom:${kq(6)};text-align:right;color:#000;line-height:1">` +
        `<div style="font-size:${kq(46)};font-weight:600;letter-spacing:.02em">${D.hm}</div>` +
        `<div style="font-size:${kq(15)};font-weight:600;letter-spacing:.06em;margin-top:${kq(2)}">${D.short}</div></div></div>` +
    `<div style="position:absolute;left:${kq(164)};right:${kq(title.length * 11 + 34)};top:${kq(10)};height:${kq(12)};background:${sc}"></div>` +
    `<div style="position:absolute;right:${kq(12)};top:${kq(4)};font-size:${kq(22)};letter-spacing:.06em;color:${sc};line-height:${kq(24)}">${title}</div>` +
    `<div style="position:absolute;left:${kq(10)};top:${kq(112)};width:${kq(120)};display:flex;flex-direction:column;gap:${kq(4)}">${btns}</div>` +
    `<div style="position:absolute;left:${kq(10)};bottom:${kq(10)};width:${kq(150)};height:${kq(56)};background:${K.lilac};border-radius:0 0 0 ${kq(40)}">` +
      `<i style="position:absolute;right:0;top:0;width:${kq(30)};height:${kq(28)};background:#000;border-radius:0 0 0 ${kq(18)}"></i></div>` +
    `<div style="position:absolute;left:${kq(164)};right:${kq(10)};bottom:${kq(10)};height:${kq(28)};background:${K.lilac};display:flex;` +
      `align-items:center;justify-content:flex-end;overflow:hidden">${seg}</div>` +
    `<div style="position:absolute;left:${kq(156)};top:${kq(32)};right:${kq(14)};bottom:${kq(44)}">${body}</div></div>`, 'landscape', TNG_LOOK);
}
function tngPill(c, t, size) {
  const sz = size || 24;
  return `<span style="display:inline-flex;align-items:center;height:${kq(sz)};padding:0 ${kq(12)};border-radius:${kq(sz / 2)};` +
    `background:${c};color:#000;font-size:${kq(size ? sz * 0.66 : 16)};font-weight:600;letter-spacing:.05em;white-space:nowrap">${t}</span>`;
}
function tngSec(c, t, r) {
  return `<div style="display:flex;align-items:center;gap:${kq(10)}">${tngPill(c, t)}<i style="flex:1;height:${kq(3)};background:${c}"></i>` +
    `<span style="color:${c};font-size:${kq(14)};letter-spacing:.08em;white-space:nowrap">${r}</span></div>`;
}
/* A big centred word in the body: pending, empty, not configured. */
function tngNote(text, color) {
  return `<div style="height:100%;display:flex;align-items:center;justify-content:center;text-align:center;color:${color};` +
    `font-size:${kq(34)};letter-spacing:.08em">${text}</div>`;
}
function tngAgo(epoch) { return hlAgo(epoch).replace(' S AGO', 'S AGO'); }

/* Issue list that scales: big rows up to 4, two compact columns up to 16, then "+N MORE"
   in the last cell. */
function tngIssueLayout(n, h) {
  if (n <= 4) return { cols: 1, rows: Math.max(1, n), rowH: Math.min(76, Math.floor(h / Math.max(1, n))), big: true, shown: n };
  const rows = Math.min(8, Math.ceil(Math.min(n, 16) / 2));
  const f = kioskFit(n, rows * 2, rows * 2 - 1);
  return { cols: 2, rows: rows, rowH: Math.floor(h / rows), big: false, shown: f.shown };
}

function tngHomelab(c) {
  kioskSkin('tng', '#000', 'Antonio');
  const K = TNG_K;
  const L = kioskLab();
  const H = kioskH();
  const n = L.issues.length;
  const healthOf = function (h) {
    return h.health === 'down' ? ['DOWN', K.red] : h.health === 'crit' ? ['ALERT', K.red] : h.health === 'warn' ? ['WARN', K.peach]
      : h.health === 'ok' ? ['HEALTHY', K.blue] : ['--', K.plan];
  };
  const SH = n <= 4 ? 50 : 36;
  const dimmed = L.stale ? 'opacity:.45;' : '';
  const sys = L.hosts.map(function (h) {
    const hc = healthOf(h);
    const cap = h.up === true ? K.blue : h.up === false ? K.red : K.plan;
    return `<div data-host="${esc(h.name)}" data-up="${h.up}" data-health="${h.health}" style="display:flex;align-items:center;height:${kq(SH)}">` +
      `<span style="width:${kq(20)};height:${kq(SH)};border-radius:${kq(SH / 2)} 0 0 ${kq(SH / 2)};background:${cap};${dimmed}"></span>` +
      `<span style="flex:1;min-width:0;height:${kq(SH)};margin-left:${kq(4)};display:flex;align-items:center;padding:0 ${kq(10)};` +
        `background:${K.row};font-size:${kq(SH > 40 ? 25 : 21)};color:${h.health === 'ok' || h.health === 'unknown' ? K.text : hc[1]};` +
        `letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(h.name)}</span>` +
      `<span style="width:${kq(98)};flex-shrink:0;height:${kq(SH)};margin-left:${kq(4)};border-radius:0 ${kq(SH / 2)} ${kq(SH / 2)} 0;` +
        `background:${hc[1]};color:#000;font-size:${kq(14)};font-weight:600;display:flex;align-items:center;justify-content:center;` +
        `gap:${kq(6)};${dimmed}">${hc[0]}${h.n && h.health !== 'down' ? `<span style="font-size:${kq(16)};font-weight:700">${h.n}</span>` : ''}</span></div>`;
  }).join('');
  const sysRows = Math.max(1, Math.ceil(L.hosts.length / 3));
  const AH = Math.max(SH, H - 32 - 44 - (n <= 4 ? 234 : 192) - (sysRows - 3) * (SH + 6) - 34);
  const lay = tngIssueLayout(n, AH);
  const sc = function (i) { return i.severity === 'crit' ? K.red : K.peach; };
  const item = function (i, k) {
    return lay.big
      ? `<div data-alert="${k}" style="display:grid;grid-template-columns:${kq(22)} 1fr auto;gap:0 ${kq(12)};align-items:center;height:${kq(lay.rowH)}">` +
          `<span style="align-self:stretch;margin:${kq(5)} 0;border-radius:${kq(11)} 0 0 ${kq(11)};background:${sc(i)}"></span>` +
          `<div style="min-width:0"><div style="font-size:${kq(16)};color:${sc(i)};letter-spacing:.12em">${esc(i.host)}</div>` +
          `<div style="font-size:${kq(27)};color:${K.text};text-transform:none;line-height:1.05;white-space:nowrap;overflow:hidden;` +
            `text-overflow:ellipsis">${esc(i.title)}</div></div>` +
          `<div style="font-size:${kq(24)};color:${K.gold}">${hlClock(i.since)}</div></div>`
      : `<div data-alert="${k}" style="display:grid;grid-template-columns:${kq(14)} ${kq(104)} 1fr ${kq(50)};gap:0 ${kq(8)};align-items:center;height:${kq(lay.rowH)}">` +
          `<span style="align-self:stretch;margin:${kq(4)} 0;border-radius:${kq(7)} 0 0 ${kq(7)};background:${sc(i)}"></span>` +
          `<span style="font-size:${kq(16)};color:${sc(i)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.host)}</span>` +
          `<span style="font-size:${kq(19)};color:${K.text};text-transform:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.title)}</span>` +
          `<span style="font-size:${kq(17)};color:${K.gold};text-align:right">${hlClock(i.since)}</span></div>`;
  };
  const shown = L.issues.slice(0, lay.shown), more = n - shown.length;
  const list = n === 0 ? `<div style="font-size:${kq(22)};color:${K.dim};letter-spacing:.08em;padding-top:${kq(10)}">NO OPEN ALERTS</div>`
    : lay.cols === 1 ? shown.map(item).join('')
    : `<div style="display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:column;grid-template-rows:repeat(${lay.rows},${kq(lay.rowH)});` +
        `gap:0 ${kq(22)}">${shown.map(item).join('')}` +
        (more ? `<div style="font-size:${kq(18)};color:${K.dim};display:flex;align-items:center">+${more} MORE</div>` : '') + `</div>`;
  const cond = { crit: ['RED ALERT', K.red], warn: ['CONDITION YELLOW', K.peach], nominal: ['ALL SYSTEMS NOMINAL', K.blue],
                 stale: ['TELEMETRY STALE', K.peach], pending: ['ACQUIRING TELEMETRY', K.lilac],
                 unconfigured: ['HOME LAB NOT CONFIGURED', K.lilac] }[L.mode] || ['HOME LAB NOT CONFIGURED', K.lilac];
  const C = L.counts;
  const summary = [[cond[0], cond[1]]];
  if (L.mode !== 'unconfigured') {
    summary.push([`${L.hosts.length} SYSTEMS`], [`${C.ok} HEALTHY`, K.blue], [`${C.warn} WARN`, K.peach],
                 [`${C.crit + C.down} ALERT`, C.crit + C.down ? K.red : K.lilac]);
    if (L.checkedAt !== null) summary.push([`CHECKED ${tngAgo(L.checkedAt)}`, L.stale ? K.peach : K.gold]);
  }
  let body;
  if (L.mode === 'unconfigured') body = tngNote('HOME LAB NOT CONFIGURED', K.dim);
  else if (L.mode === 'pending' && !L.hosts.length) body = tngNote('ACQUIRING TELEMETRY', K.lilac);
  else {
    const systems = new Set(L.issues.map(function (i) { return String(i.host); })).size;
    body = tngSec(K.violet, 'SYSTEMS', 'UP / HEALTH') +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:${kq(6)} ${kq(12)};margin-top:${kq(8)}">${sys}</div>` +
      `<div style="margin-top:${kq(12)}">` +
        tngSec(n ? sc(L.issues[0]) : K.blue, 'ALERTS', L.mode === 'pending' ? 'ACQUIRING TELEMETRY' : `${n} OPEN · ${systems} SYSTEMS`) + `</div>` +
      `<div style="margin-top:${kq(6)};height:${kq(AH)};overflow:hidden">${list}</div>`;
  }
  return tngFrame('lab', 'SHIP STATUS', summary, body);
}

const TNG_SESS = { waiting: '#FF9966', busy: '#99CCFF', shell: '#CC99CC', idle: '#8888AA' };
function tngSessions(c) {
  kioskSkin('tng', '#000', 'Antonio');
  const K = TNG_K;
  const D = kioskSess();
  const H = kioskH();
  const cols = [22, 'minmax(0,1fr)', 130, 160, 100, 64, 86].map(function (w) { return typeof w === 'number' ? kq(w) : w; }).join(' ');
  // Five rows at the design height, more in a taller frame, never more than fit.
  const budget = H - 76 - 22, rowsH = function (list) {
    return list.reduce(function (a, s) { return a + (s.message ? 80 : 68) + 6; }, 0);
  };
  const capFor = function (room) {
    let k = 0;
    while (k < D.list.length && rowsH(D.list.slice(0, k + 1)) <= room) k++;
    return Math.min(k, 5 + Math.max(0, Math.floor((H - 600) / 74)));
  };
  const f = kioskFit(D.list.length, capFor(budget), capFor(budget - 34));
  const shown = D.list.slice(0, f.shown);
  const stc = function (s) { return TNG_SESS[s.state] || TNG_SESS.idle; };
  const rows = shown.map(function (s, k) {
    return `<div data-session="${k}" style="display:grid;grid-template-columns:${cols};gap:0 ${kq(12)};align-items:center;height:${kq(s.message ? 80 : 68)};margin-top:${kq(6)}">` +
      `<span style="height:100%;border-radius:${kq(11)} 0 0 ${kq(11)};background:${stc(s)}"></span>` +
      `<div style="min-width:0"><div style="font-size:${kq(31)};color:${s.state === 'waiting' ? K.peach : K.text};text-transform:none;line-height:1.05;` +
        `white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</div>` +
        (s.message ? `<div style="font-size:${kq(16)};color:${K.peach};text-transform:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.message)}</div>` : '') + `</div>` +
      `<div style="font-size:${kq(20)};color:${K.dim};text-transform:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.project)}</div>` +
      `<div>${tngPill(stc(s), SESS_LABEL[s.state] || SESS_LABEL.idle, 24)}</div>` +
      `<div style="text-align:right;font-size:${kq(27)};color:${K.gold}">${kioskTok(s.tokens)}</div>` +
      `<div style="text-align:right;font-size:${kq(27)};color:${K.blue}">${s.agents ? esc(s.agents) : '<span style="color:#555">--</span>'}</div>` +
      `<div style="text-align:right;font-size:${kq(27)};color:${s.state === 'waiting' ? K.peach : K.text}">${sessAge(s.since)}</div></div>`;
  }).join('');
  const off = D.status === 'offline';
  let body;
  if (D.status === 'unconfigured') body = tngNote('SESSION FEED NOT CONFIGURED', K.dim);
  else if (D.status === 'pending') body = tngNote('CONNECTING TO SESSION FEED', K.lilac);
  else if (!D.list.length) body = off ? tngNote('SESSION FEED OFFLINE', K.peach) : tngNote('NO ACTIVE SESSIONS', K.dim);
  else {
    body = `<div style="display:grid;grid-template-columns:${cols};gap:0 ${kq(12)};font-size:${kq(16)};color:${K.dim};letter-spacing:.12em">` +
        `<span></span><span>SESSION</span><span>PROJECT</span><span>STATUS</span><span style="text-align:right">TOKENS</span>` +
        `<span style="text-align:right">AGENTS</span><span style="text-align:right">TIME</span></div>` +
      `<div style="${off ? 'opacity:.45' : ''}">${rows}</div>` +
      (f.more ? `<div style="margin-top:${kq(8)};font-size:${kq(20)};color:${K.dim};letter-spacing:.12em">+${f.more} MORE</div>` : '');
  }
  const summary = [[`${D.list.length} ACTIVE`], [`${D.waiting} AWAITING INPUT`, D.waiting ? K.peach : K.lilac]];
  if (off) summary.push([`SESSION FEED OFFLINE · LAST UPDATE ${D.checkedAt ? hlClock(D.checkedAt) : 'NEVER'}`, K.peach]);
  else if (D.status === 'ok') summary.push([`FEED LIVE${D.host ? ' · ' + esc(D.host) : ''}`, K.gold]);
  else if (D.status === 'pending') summary.push(['CONNECTING', K.lilac]);
  return tngFrame('sessions', 'CREW SESSIONS', summary, body);
}

const TNG_GPU = { throttling: '#FF9966', hot: '#FF9966', critical: '#FF5544', busy: '#99CCFF', idle: '#8888AA' };
function tngGpus(c) {
  kioskSkin('tng', '#000', 'Antonio');
  const K = TNG_K;
  const G = kioskGpus();
  const H = kioskH();
  const empty = gpuEmptyNote(G);
  const n = G.rows.length;
  const hosts = [];
  G.rows.forEach(function (r) { if (hosts.indexOf(r.host) === -1) hosts.push(r.host); });
  const hc = [K.orange, K.lilac, K.violet, K.gold, K.blue];
  // Groups by host, in order of their worst card; the rows inside keep that order.
  const ordered = hosts.reduce(function (a, h) { return a.concat(G.rows.filter(function (r) { return r.host === h; })); }, []);
  const banner = G.stale ? 30 : 0;
  const budget = H - 76 - banner - hosts.length * 34;
  const f = kioskFit(n, Math.floor(budget / 42), Math.floor((budget - 26) / 42));
  const vis = ordered.slice(0, f.shown);
  const rowH = Math.max(42, Math.min(78, Math.floor((budget - (f.more ? 26 : 0)) / Math.max(1, f.shown))));
  const big = rowH >= 62;
  const bar = function (pct, color) {
    const w = pct === null ? 0 : Math.max(0, Math.min(100, pct));
    return `<div style="height:${kq(16)};border-radius:${kq(8)};background:${K.track};overflow:hidden">` +
      `<i style="display:block;height:100%;width:${w}%;border-radius:${kq(8)};background:${color}"></i></div>`;
  };
  const row = function (g) {
    const col = TNG_GPU[g.state] || K.grey;
    const util = gpuFin(g.util), temp = gpuFin(g.temp), pw = gpuFin(g.power), lim = gpuFin(g.power_limit), pr = gpuFin(g.procs);
    const v = gpuVram(g);
    const mt = gpuFin(g.mem_temp);
    const mem = mt !== null && mt >= -50 && mt <= 200
      ? `<div style="font-size:${kq(15)};color:${mt >= 85 ? K.peach : K.dim}">MEM ${Math.round(mt)}&deg;</div>` : '';
    const seen = g.fresh ? '' : `<div style="font-size:${kq(12)};color:${K.dim};letter-spacing:.06em">SEEN ${g.seen_at ? sessAge(g.seen_at) : '--'} AGO</div>`;
    return `<div data-gpu-row="${esc(g.host)}|${g.index}" style="display:grid;grid-template-columns:${kq(big ? 120 : 104)} ${kq(128)} minmax(0,1fr) minmax(0,1fr) ${kq(84)} ${kq(140)};` +
        `gap:0 ${kq(14)};align-items:center;height:${kq(rowH)};${g.fresh ? '' : 'opacity:.6'}">` +
      `<div style="min-width:0"><div style="font-size:${kq(big ? 26 : 22)};color:${K.text};line-height:1">GPU ${g.index}</div>` +
        `<div style="font-size:${kq(14)};color:${K.dim};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.short)}</div></div>` +
      `<div>${tngPill(col, GPU_LABEL[g.state], 24)}${seen}</div>` +
      `<div><div style="display:flex;justify-content:space-between;font-size:${kq(15)};color:${K.dim};letter-spacing:.1em"><span>LOAD</span>` +
        `<span style="color:${K.gold};font-size:${kq(19)}">${util === null ? '--' : Math.round(util) + '%'}</span></div>${bar(util, col)}</div>` +
      `<div><div style="display:flex;justify-content:space-between;font-size:${kq(15)};color:${K.dim};letter-spacing:.1em"><span>VRAM</span>` +
        `<span style="color:${K.gold};font-size:${kq(19)}">${v.text}</span></div>${bar(v.pct, K.lilac)}</div>` +
      `<div style="text-align:right;line-height:1"><span style="font-size:${kq(big ? 36 : 30)};color:${temp === null ? K.dim : temp >= 85 ? K.peach : K.blue}">` +
        `${temp === null ? '--' : Math.round(temp) + '&deg;'}</span>${mem}</div>` +
      `<div style="text-align:right;line-height:1.1"><span style="font-size:${kq(big ? 27 : 23)};color:${K.text}">${pw === null ? '--' : Math.round(pw)}</span>` +
        `<span style="font-size:${kq(16)};color:${K.dim}"> / ${lim === null ? '--' : Math.round(lim)} W</span>` +
        `<div style="font-size:${kq(15)};color:${K.dim}">${pr === null ? '--' : pr} PROC${pr === 1 ? '' : 'S'}</div></div></div>`;
  };
  let body;
  if (empty) {
    body = (G.stale ? `<div style="font-size:${kq(18)};color:${K.peach};letter-spacing:.08em">TELEMETRY STALE · LAST UPDATE ${G.checked}</div>` : '') +
      tngNote(empty[0], empty[1] === bsS().warn ? K.peach : K.dim);
  } else {
    body = (G.stale ? `<div style="height:${kq(banner)};font-size:${kq(18)};color:${K.peach};letter-spacing:.08em">TELEMETRY STALE · LAST UPDATE ${G.checked}</div>` : '') +
      hosts.map(function (h, k) {
        const gs = vis.filter(function (r) { return r.host === h; });
        if (!gs.length) return '';
        const all = G.rows.filter(function (r) { return r.host === h; }).length;
        return `<div style="margin-top:${kq(k ? 6 : 0)}">${tngSec(hc[k % hc.length], esc(h).toUpperCase(), `${all} ${all > 1 ? 'CARDS' : 'CARD'}`)}</div>` +
          gs.map(row).join('');
      }).join('') +
      (f.more ? `<div style="height:${kq(26)};display:flex;align-items:center;font-size:${kq(18)};color:${K.dim};letter-spacing:.12em">+${f.more} MORE</div>` : '');
  }
  const summary = [];
  if (G.stale) summary.push(['TELEMETRY STALE', K.peach]);
  if (!empty) {
    summary.push([`${n} GPU${n === 1 ? '' : 'S'}`], [`${G.busy} BUSY`, K.blue], [`${G.hot} HOT/THROTTLING`, G.hot ? K.peach : K.lilac],
                 [G.powerText, K.gold]);
    if (G.incomplete.length) summary.push(['NOT REACHED: ' + gpuHostList(G.incomplete), K.peach]);
  }
  summary.push(['CHECKED ' + G.checked]);
  return tngFrame('gpus', 'GPU STATUS', summary, body);
}

function tngNotice(c) {
  kioskSkin('tng', '#000', 'Antonio');
  return tngFrame('', 'NO SCREENS', [['NO SCREENS TO SHOW', TNG_K.lilac]],
    tngNote('NO SCREENS TO SHOW · CHOOSE THEM IN THE CONTROL PANEL', TNG_K.dim));
}

/* ── DS9 ──────────────────────────────────────────────────────────────────
 * The v1 DS9 board plus a full-width 6-unit status bar (teal fine, amber
 * warning, red alert, the worst of the plan's screens). Angled chips for tabs,
 * the clock top right with day and date. Reference: v4 prototype ds9Frame /
 * ds9LabV2 / ds9SessionsV2 / ds9GpusV2. */
const D9_K = { bg: '#111419', teal: '#2A9D8F', orange: '#E7442A', steel: '#9EA5BA', dim: '#6D748C', lav: '#B9BCD8',
               violet: '#8C8FC4', hi: '#D9DCEB', panel: '#1a1f28', track: '#2F3749', red: '#FF4444', tint: '#2a1712',
               chip: '#232a37', ghost: '#171b22', ghostText: '#3b4252', ink: '#0b0e12' };
const D9_STATUS = { ok: '#2A9D8F', warn: '#F2A33A', crit: '#FF3B30' };
const D9_LOOK = 'Sci-Fi/DS9';

function ds9Frame(active, body, foot) {
  const K = D9_K;
  const tabs = kioskMenu(active).map(function (t) {
    const att = t.att === 'crit' ? D9_STATUS.crit : t.att === 'warn' ? D9_STATUS.warn : null;
    const bg = t.active ? K.teal : t.built ? K.chip : K.ghost;
    const fg = t.active ? K.ink : !t.built ? K.ghostText : !t.live ? K.dim : att || K.steel;
    const tri = t.active ? K.ink : att || K.orange;
    return `<div${kioskTabAttrs(t)} style="height:${kq(36)};display:flex;align-items:center;gap:${kq(7)};padding:0 ${kq(22)} 0 ${kq(18)};` +
        `clip-path:polygon(${kq(14)} 0,100% 0,calc(100% - ${kq(14)}) 100%,0 100%);font-size:${kq(t.built ? 15 : 13)};letter-spacing:.12em;` +
        `background:${bg};color:${fg};white-space:nowrap">` +
      (t.built ? `<i style="width:0;height:0;border-left:${kq(7)} solid transparent;border-right:${kq(7)} solid transparent;` +
        `border-bottom:${kq(11)} solid ${t.live ? tri : K.ghostText}"></i>` : '') + esc(t.label) + `</div>`;
  }).join('');
  const D = kioskClock();
  const worst = kioskWorst(), bar = D9_STATUS[worst];
  return bsFrame(`<div data-status="${worst}" style="position:absolute;inset:0;background:${K.bg};font-family:Rajdhani;font-weight:600;` +
      `color:${K.steel};text-transform:uppercase">` +
    `<div style="position:absolute;left:0;right:0;top:0;height:${kq(6)};background:${bar};${worst === 'ok' ? '' : `box-shadow:0 0 ${kq(14)} ${bar}88;`}"></div>` +
    `<div style="position:absolute;left:${kq(14)};top:${kq(18)};display:flex;gap:${kq(4)}">${tabs}</div>` +
    `<div style="position:absolute;right:${kq(18)};top:${kq(10)};text-align:right">` +
      `<div style="font-size:${kq(48)};line-height:1;color:${K.lav}">${D.hm.replace(':', `<span style="color:${K.orange}">:</span>`)}</div>` +
      `<div style="font-size:${kq(13)};letter-spacing:.22em;color:${K.teal}">${D.day} · ${D.date}</div></div>` +
    `<div style="position:absolute;left:${kq(14)};right:${kq(14)};top:${kq(76)};height:${kq(2)};background:${K.teal}55"></div>` +
    `<div style="position:absolute;left:${kq(14)};right:${kq(14)};top:${kq(88)};bottom:${kq(34)}">${body}</div>` +
    `<div style="position:absolute;left:${kq(14)};right:${kq(14)};bottom:${kq(10)};display:flex;align-items:center;gap:${kq(10)};` +
      `font-size:${kq(13)};letter-spacing:.22em;color:${K.dim};white-space:nowrap">` +
      `<i style="width:0;height:0;border-left:${kq(9)} solid transparent;border-bottom:${kq(9)} solid ${K.orange}"></i>` +
      `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${foot}</span>` +
      `<i style="flex:1;min-width:${kq(20)};height:${kq(2)};background:${K.orange}55"></i></div></div>`, 'landscape', D9_LOOK);
}
function d9hdr(c, t, r) {
  return `<div style="display:flex;align-items:center;height:${kq(26)}"><span style="height:${kq(26)};display:flex;align-items:center;` +
    `padding:0 ${kq(18)} 0 ${kq(22)};background:${c};color:${D9_K.ink};clip-path:polygon(${kq(16)} 0,100% 0,100% 100%,0 100%);` +
    `font-size:${kq(15)};letter-spacing:.16em;white-space:nowrap">${t}</span><i style="flex:1;height:${kq(2)};background:${c};opacity:.6"></i>` +
    (r ? `<span style="color:${c};font-size:${kq(15)};letter-spacing:.12em;padding-left:${kq(10)};white-space:nowrap">${r}</span>` : '') + `</div>`;
}
function d9cf(bg) {
  return `clip-path:polygon(${kq(14)} 0,100% 0,100% calc(100% - ${kq(14)}),calc(100% - ${kq(14)}) 100%,0 100%,0 ${kq(14)});background:${bg || D9_K.panel}`;
}
function d9sk(c, pct) {
  const w = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return `<div style="height:${kq(14)};background:${D9_K.track};position:relative;transform:skewX(-24deg)">` +
    `<i style="position:absolute;left:0;top:0;bottom:0;width:${w}%;background:${c}"></i></div>`;
}
function d9Note(text, color) {
  return `<div style="height:100%;display:flex;align-items:center;justify-content:center;text-align:center;color:${color};` +
    `font-size:${kq(34)};letter-spacing:.16em">${text}</div>`;
}

function ds9Homelab(c) {
  kioskSkin('ds9', D9_K.bg, 'Rajdhani');
  const K = D9_K;
  const L = kioskLab();
  const H = kioskH();
  const C = L.counts;
  const cond = { crit: ['RED', K.red], warn: ['YELLOW', K.orange], nominal: ['GREEN', K.teal], stale: ['STALE', K.orange],
                 pending: ['--', K.dim], unconfigured: ['--', K.dim] }[L.mode] || ['--', K.dim];
  const dim = L.stale ? 'opacity:.45;' : '';
  // Two signals per host: the triangle is up (teal up, red down, dim unknown); the
  // text, tint and right-hand word are health.
  const chips = L.hosts.map(function (h) {
    const up = h.up === true ? K.teal : h.up === false ? K.red : K.dim;
    const hc = h.health === 'ok' ? K.steel : h.health === 'warn' ? K.orange : h.health === 'unknown' ? K.dim : K.red;
    const word = h.health === 'down' ? 'DOWN' : h.health === 'unknown' ? '--' : h.n ? String(h.n) : '';
    const bad = h.health === 'warn' || h.health === 'crit' || h.health === 'down';
    return `<div data-host="${esc(h.name)}" data-up="${h.up}" data-health="${h.health}" style="${d9cf(bad ? K.tint : K.panel)};height:${kq(30)};` +
        `display:flex;align-items:center;gap:${kq(8)};padding:0 ${kq(10)};font-size:${kq(15)};letter-spacing:.1em;color:${hc};${dim}">` +
      `<i style="width:0;height:0;border-left:${kq(6)} solid transparent;border-right:${kq(6)} solid transparent;border-bottom:${kq(10)} solid ${up}"></i>` +
      `<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(h.name)}</span>` +
      (word ? `<span style="color:${hc}">${word}</span>` : '') + `</div>`;
  }).join('');
  const left = d9hdr(K.orange, 'OPS · STATION') +
    `<div style="margin-top:${kq(14)};font-size:${kq(15)};letter-spacing:.24em;color:${K.dim}">CONDITION</div>` +
    `<div style="font-size:${kq(64)};line-height:.95;color:${cond[1]};letter-spacing:.04em">${cond[0]}</div>` +
    `<div style="display:flex;gap:${kq(18)};margin-top:${kq(10)}">` +
      [[C.ok, 'HEALTHY', K.lav], [C.warn + C.crit + C.down, 'REPORTING', K.orange], [L.hosts.length, 'SYSTEMS', K.lav]].map(function (x) {
        return `<div><div style="font-size:${kq(44)};color:${x[2]};line-height:1">${x[0]}</div>` +
          `<div style="font-size:${kq(12)};letter-spacing:.2em">${x[1]}</div></div>`;
      }).join('') + `</div>` +
    `<div style="margin-top:${kq(16)};display:grid;grid-template-columns:1fr 1fr;gap:${kq(5)}">${chips}</div>`;
  const AH = H - 88 - 34 - 34;
  const n = L.issues.length;
  const sev = function (i) { return i.severity === 'crit' ? K.red : K.orange; };
  let right = d9hdr(K.violet, 'ALERTS', `${n} OPEN`);
  if (L.mode === 'pending') right += d9Note('ACQUIRING TELEMETRY', K.dim);
  else if (n === 0) right += `<div style="margin-top:${kq(14)};font-size:${kq(22)};letter-spacing:.16em;color:${K.dim}">NO OPEN ALERTS</div>`;
  else if (n <= 4) {
    right += L.issues.map(function (i, k) {
      return `<div data-alert="${k}" style="${d9cf()};margin-top:${kq(10)};padding:${kq(12)} ${kq(16)} ${kq(12)} ${kq(20)};border-left:${kq(5)} solid ${sev(i)};` +
          `display:grid;grid-template-columns:1fr auto;gap:${kq(2)} ${kq(14)}">` +
        `<div style="font-size:${kq(14)};letter-spacing:.2em;color:${sev(i)}">${esc(i.host)}</div>` +
        `<div style="font-size:${kq(13)};letter-spacing:.2em;color:${K.dim};text-align:right">SINCE</div>` +
        `<div style="font-size:${kq(27)};color:${K.hi};text-transform:none;line-height:1.1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.title)}</div>` +
        `<div style="font-size:${kq(26)};color:${K.lav};text-align:right">${hlClock(i.since)}</div>` +
        `<div style="font-size:${kq(14)};color:${K.dim};text-transform:none;font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.detail)}</div></div>`;
    }).join('');
  } else {
    const rows = Math.min(n, 13 + Math.max(0, Math.floor((H - 600) / 34)));
    const f = kioskFit(n, rows, rows - 1);
    const rowH = Math.floor((AH - 8) / rows);
    right += `<div style="margin-top:${kq(8)};display:flex;flex-direction:column;gap:0">` +
      L.issues.slice(0, f.shown).map(function (i, k) {
        return `<div data-alert="${k}" style="height:${kq(rowH - 3)};margin-bottom:${kq(3)};${d9cf()};border-left:${kq(5)} solid ${sev(i)};` +
            `display:grid;grid-template-columns:${kq(120)} 1fr ${kq(54)};gap:0 ${kq(12)};align-items:center;padding:0 ${kq(12)} 0 ${kq(16)}">` +
          `<span style="font-size:${kq(15)};letter-spacing:.14em;color:${sev(i)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.host)}</span>` +
          `<span style="font-size:${kq(19)};color:${K.hi};text-transform:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.title)}</span>` +
          `<span style="font-size:${kq(17)};color:${K.lav};text-align:right">${hlClock(i.since)}</span></div>`;
      }).join('') +
      (f.more ? `<div style="font-size:${kq(15)};letter-spacing:.2em;color:${K.dim};margin-top:${kq(4)}">+${f.more} MORE</div>` : '') + `</div>`;
  }
  const foot = L.mode === 'stale' ? `TELEMETRY STALE · NO FRESH CHECK FOR ${hlAgo(L.checkedAt).replace(' AGO', '')}`
    : L.mode === 'pending' ? 'ACQUIRING TELEMETRY'
    : L.checkedAt !== null ? `CHECKED ${hlAgo(L.checkedAt)} · ${L.hosts.length} HOSTS` : '';
  const body = L.mode === 'unconfigured' ? d9Note('HOME LAB NOT CONFIGURED', K.dim)
    : `<div style="display:grid;grid-template-columns:${kq(380)} 1fr;gap:${kq(26)};height:100%"><div>${left}</div><div style="min-width:0">${right}</div></div>`;
  return ds9Frame('lab', body, foot);
}

const D9_SESS = { waiting: '#E7442A', busy: '#2A9D8F', shell: '#8C8FC4', idle: '#6D748C' };
function ds9Sessions(c) {
  kioskSkin('ds9', D9_K.bg, 'Rajdhani');
  const K = D9_K;
  const D = kioskSess();
  const H = kioskH();
  const cols = ['minmax(0,1fr)', 130, 160, 100, 70, 86].map(function (w) { return typeof w === 'number' ? kq(w) : w; }).join(' ');
  const budget = H - 122 - 26 - 30;
  // Row heights (with a message, without); a short frame full of messages
  // tightens them rather than show fewer than five.
  let RH = [72, 60];
  const capFor = function (room) {
    let k = 0, used = 0;
    while (k < D.list.length && used + (D.list[k].message ? RH[0] : RH[1]) + 6 <= room) { used += (D.list[k].message ? RH[0] : RH[1]) + 6; k++; }
    return Math.min(k, 5 + Math.max(0, Math.floor((H - 600) / 66)));
  };
  if (capFor(budget - 30) < Math.min(5, D.list.length) && D.list.length > capFor(budget)) RH = [62, 52];
  const f = kioskFit(D.list.length, capFor(budget), capFor(budget - 30));
  const stc = function (s) { return D9_SESS[s.state] || D9_SESS.idle; };
  const off = D.status === 'offline';
  let body;
  if (D.status === 'unconfigured') body = d9Note('SESSION FEED NOT CONFIGURED', K.dim);
  else if (D.status === 'pending') body = d9Note('CONNECTING TO SESSION FEED', K.dim);
  else if (!D.list.length) body = off ? d9Note('SESSION FEED OFFLINE', K.orange) : d9Note('NO ACTIVE SESSIONS', K.dim);
  else {
    body = d9hdr(K.teal, 'SESSIONS', `${D.list.length} ACTIVE · ${D.waiting} AWAITING INPUT`) +
      `<div style="display:grid;grid-template-columns:${cols};gap:0 ${kq(14)};padding:${kq(10)} ${kq(20)} ${kq(4)} ${kq(24)};font-size:${kq(13)};` +
        `letter-spacing:.2em;color:${K.dim}"><span>SESSION</span><span>PROJECT</span><span>STATUS</span><span style="text-align:right">TOKENS</span>` +
        `<span style="text-align:right">AGENTS</span><span style="text-align:right">TIME</span></div>` +
      `<div style="${off ? 'opacity:.45' : ''}">` +
      D.list.slice(0, f.shown).map(function (s, k) {
        return `<div data-session="${k}" style="${d9cf(s.state === 'waiting' ? K.tint : K.panel)};margin-top:${kq(6)};border-left:${kq(5)} solid ${stc(s)};` +
            `display:grid;grid-template-columns:${cols};gap:0 ${kq(14)};align-items:center;padding:0 ${kq(20)};height:${kq(s.message ? RH[0] : RH[1])}">` +
          `<div style="min-width:0"><div style="font-size:${kq(27)};color:${K.hi};text-transform:none;line-height:1.05;white-space:nowrap;overflow:hidden;` +
            `text-overflow:ellipsis">${esc(s.name)}</div>` +
            (s.message ? `<div style="font-size:${kq(14)};color:${K.orange};text-transform:none;font-weight:500;white-space:nowrap;overflow:hidden;` +
              `text-overflow:ellipsis">${esc(s.message)}</div>` : '') + `</div>` +
          `<div style="font-size:${kq(17)};text-transform:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.project)}</div>` +
          `<div style="font-size:${kq(15)};letter-spacing:.14em;color:${stc(s)};white-space:nowrap">${SESS_LABEL[s.state] || SESS_LABEL.idle}</div>` +
          `<div style="text-align:right;font-size:${kq(23)};color:${K.lav}">${kioskTok(s.tokens)}</div>` +
          `<div style="text-align:right;font-size:${kq(23)};color:${K.violet}">${s.agents ? esc(s.agents) : `<span style="color:${K.ghostText}">--</span>`}</div>` +
          `<div style="text-align:right;font-size:${kq(23)};color:${s.state === 'waiting' ? K.orange : K.lav}">${sessAge(s.since)}</div></div>`;
      }).join('') + `</div>` +
      (f.more ? `<div style="margin-top:${kq(10)};font-size:${kq(16)};letter-spacing:.22em;color:${K.dim}">+${f.more} MORE</div>` : '');
  }
  const foot = off ? `SESSION FEED OFFLINE · LAST UPDATE ${D.checkedAt ? hlClock(D.checkedAt) : 'NEVER'}`
    : D.status === 'ok' ? `FEED LIVE${D.host ? ' · ' + esc(D.host) : ''}` : D.status === 'pending' ? 'CONNECTING' : '';
  return ds9Frame('sessions', body, foot);
}

const D9_GPU = { throttling: '#E7442A', hot: '#E7442A', critical: '#FF4444', busy: '#2A9D8F', idle: '#6D748C' };
function ds9Gpus(c) {
  kioskSkin('ds9', D9_K.bg, 'Rajdhani');
  const K = D9_K;
  const G = kioskGpus();
  const H = kioskH();
  const empty = gpuEmptyNote(G);
  const n = G.rows.length;
  const fresh = G.rows.filter(function (r) { return r.fresh; });
  let drawn = 0, rated = 0, known = 0;
  fresh.forEach(function (r) { const p = gpuFin(r.power), l = gpuFin(r.power_limit); if (p !== null && l !== null) { drawn += p; rated += l; known++; } });
  const hottest = fresh.filter(function (r) { return gpuFin(r.temp) !== null; }).sort(function (a, b) { return b.temp - a.temp; })[0];
  const pw = /^(\S+) (.*)$/.exec(G.powerText) || ['', '--', 'W'];
  const left = d9hdr(K.orange, 'GPU ARRAY') +
    `<div style="display:flex;gap:${kq(22)};margin-top:${kq(16)}">` +
      [[n, 'CARDS', K.lav], [G.busy + G.hot, 'ACTIVE', K.teal], [G.hot, 'HOT/THROT', K.orange]].map(function (x) {
        return `<div><div style="font-size:${kq(60)};line-height:1;color:${x[2]}">${x[0]}</div><div style="font-size:${kq(12)};letter-spacing:.2em">${x[1]}</div></div>`;
      }).join('') + `</div>` +
    `<div style="margin-top:${kq(22)};font-size:${kq(13)};letter-spacing:.2em">POWER DRAW</div>` +
    `<div style="font-size:${kq(40)};color:${K.hi};line-height:1.1">${pw[1]} <span style="font-size:${kq(18)};color:${K.dim}">${pw[2]}</span></div>` +
    `<div style="margin-top:${kq(8)};width:${kq(220)}">${d9sk(K.teal, known && rated > 0 ? drawn / rated * 100 : null)}</div>` +
    `<div style="font-size:${kq(12)};letter-spacing:.2em;margin-top:${kq(6)}">OF ${known ? Math.round(rated) : '--'} W RATED</div>` +
    `<div style="margin-top:${kq(22)};font-size:${kq(13)};letter-spacing:.2em">HOTTEST</div>` +
    `<div style="font-size:${kq(34)};color:${K.hi};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">` +
      (hottest ? `${esc(hottest.host)} ${Math.round(hottest.temp)}&deg;` + (function () {
        const mt = gpuFin(hottest.mem_temp);
        return mt !== null && mt >= -50 && mt <= 200 ? ` <span style="font-size:${kq(18)};color:${K.orange}">MEM ${Math.round(mt)}&deg;</span>` : '';
      })() : '--') + `</div>`;
  const banner = G.stale ? 30 : 0;
  const AH = H - 88 - 34 - banner;
  const f = kioskFit(n, Math.floor(AH / 50), Math.floor((AH - 24) / 50));
  const rowH = Math.max(44, Math.min(116, Math.floor((AH - (f.more ? 24 : 0)) / Math.max(1, f.shown)) - 6));
  const compact = rowH < 90;
  const rows = G.rows.slice(0, f.shown).map(function (g) {
    const col = D9_GPU[g.state] || K.dim;
    const util = gpuFin(g.util), temp = gpuFin(g.temp), pwr = gpuFin(g.power);
    const v = gpuVram(g);
    const mt = gpuFin(g.mem_temp);
    const mem = mt !== null && mt >= -50 && mt <= 200;
    const word = `<span style="color:${col}">${GPU_LABEL[g.state]}</span>`;
    const seen = g.fresh ? '' : ` · SEEN ${g.seen_at ? sessAge(g.seen_at) : '--'} AGO`;
    return `<div data-gpu-row="${esc(g.host)}|${g.index}" style="${d9cf()};margin-bottom:${kq(6)};height:${kq(rowH)};border-left:${kq(5)} solid ${col};` +
        `padding:0 ${kq(16)} 0 ${kq(20)};display:grid;grid-template-columns:${kq(150)} 1fr 1fr ${kq(90)};gap:${kq(4)} ${kq(18)};align-items:center;` +
        `${g.fresh ? '' : 'opacity:.6;'}">` +
      `<div style="min-width:0"><div style="font-size:${kq(compact ? 21 : 24)};color:${K.hi};line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.host)}</div>` +
        `<div style="font-size:${kq(13)};letter-spacing:.14em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">GPU ${g.index} · ${esc(g.short)}${compact ? seen : ''}</div>` +
        (compact ? '' : `<div style="font-size:${kq(14)};letter-spacing:.2em;margin-top:${kq(2)}">${word}${seen}</div>`) + `</div>` +
      `<div><div style="font-size:${kq(12)};letter-spacing:.2em;display:flex;justify-content:space-between"><span>LOAD${compact ? ' · ' + word : ''}</span>` +
        `<span style="color:${K.hi};font-size:${kq(16)}">${util === null ? '--' : Math.round(util) + '%'}</span></div>${d9sk(col, util)}</div>` +
      `<div><div style="font-size:${kq(12)};letter-spacing:.2em;display:flex;justify-content:space-between"><span>VRAM</span>` +
        `<span style="color:${K.hi};font-size:${kq(16)}">${v.text.replace(' / ', '/')}</span></div>${d9sk(K.violet, v.pct)}</div>` +
      `<div style="text-align:right"><div style="font-size:${kq(compact ? 26 : 30)};line-height:1;color:${temp === null ? K.dim : temp >= 85 ? K.orange : K.lav}">` +
        `${temp === null ? '--' : Math.round(temp) + '&deg;'}</div><div style="font-size:${kq(12)};letter-spacing:.14em">` +
        (mem ? `<span style="color:${mt >= 85 ? K.orange : K.dim}">MEM ${Math.round(mt)}&deg;</span>` : `${pwr === null ? '--' : Math.round(pwr)} W`) + `</div></div></div>`;
  }).join('') + (f.more ? `<div style="height:${kq(24)};font-size:${kq(15)};letter-spacing:.2em;color:${K.dim}">+${f.more} MORE</div>` : '');
  const stale = G.stale ? `<div style="height:${kq(banner)};font-size:${kq(18)};letter-spacing:.16em;color:${D9_STATUS.warn}">TELEMETRY STALE · LAST UPDATE ${G.checked}</div>` : '';
  const body = empty ? stale + d9Note(empty[0], empty[1] === bsS().warn ? D9_STATUS.warn : K.dim)
    : `<div style="display:grid;grid-template-columns:${kq(330)} 1fr;gap:${kq(24)};height:100%"><div style="min-width:0">${left}</div>` +
      `<div style="min-width:0">${stale}${rows}</div></div>`;
  const foot = empty ? 'CHECKED ' + G.checked
    : `${n} GPU${n === 1 ? '' : 'S'} · ${G.powerText} · CHECKED ${G.checked}` + (G.incomplete.length ? ' · NOT REACHED: ' + gpuHostList(G.incomplete) : '');
  return ds9Frame('gpus', body, foot);
}

function ds9Notice(c) {
  kioskSkin('ds9', D9_K.bg, 'Rajdhani');
  return ds9Frame('', d9Note('NO SCREENS TO SHOW · CHOOSE THEM IN THE CONTROL PANEL', D9_K.dim), '');
}
