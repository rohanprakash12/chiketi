/* ── kiosk_retro.js: the Kiosk screens in the Retro (Vintage) looks ────────
 * Scanlines and VFD keep their family's skin (glass, glow, raster, filaments) as a
 * frozen look variant (kioskSkinFrom) and draw Home Lab, Sessions and GPUs in their
 * own idiom; the data, menu and status come from kiosk_looks.js. Tubes joins in
 * phase 3. server.py appends this file after kiosk_terminal.js. */

/* ================================ Scanlines ================================ */
/* Today's Scanlines skin, brighter (v3): content lifted, glow stronger, a lighter
   vignette, and a finer raster -- 3 units at two-thirds of today's strength, and
   2 units at 40 % on the GPU screen, which has the smallest type. */
const SCAN_K = { kHour: _SC.cyan || '#00FFCC', kSec: _SC.amber || '#FFAA00', kDay: _SC.amber || '#FFAA00',
                 kDate: _SC.cyan || '#00FFCC' };
/* The raster in frame units (today's ramp, _crtScanlines, at a unit pitch). */
function kioskScanlines(pitch, peak) {
  const at = function (f) { return kq(pitch * f); };
  const a = function (f) { return 'rgba(0,0,0,' + (peak * f).toFixed(3) + ')'; };
  return 'background:repeating-linear-gradient(0deg,' + a(1) + ' 0px,' + a(0.45) + ' ' + at(0.28) + ',' +
    a(0.06) + ' ' + at(0.5) + ',' + a(0.45) + ' ' + at(0.72) + ',' + a(1) + ' ' + at(1) + ')';
}
function scanSkin(pitch, peak) {
  return kioskSkinFrom('scan-' + pitch + '-' + peak, BS_SKIN_SCAN, Object.assign({}, SCAN_K, {
    overlay: CRT_OVERLAY.replace(_crtScanlines(4, 0.30), kioskScanlines(pitch, peak)),
    contentFilter: 'brightness(1.18) saturate(1.06)',
    frameCss: 'border-radius:' + kq(22) + ';box-shadow:inset 0 0 ' + kq(90) + ' ' + kq(40) + ' rgba(0,0,0,0.5)',
    glowFn: function (px, c) { return BS_SKIN_SCAN.glowFn(px * 1.35, c).replace(/66,/g, 'a0,').replace(/2b/g, '48'); },
    gpuState: function (st) {
      const S = bsS();
      return st === 'critical' ? S.crit : (st === 'hot' || st === 'throttling') ? S.warn
        : st === 'busy' ? S.a4 : st === 'idle' ? S.a2 : S.soft;
    },
  }));
}
/* The frame every Scanlines screen shares: a status line in `status`, today's
   header (plan tabs, date, clock), the body, the footer. */
function scanFrame(active, status, body, foot) {
  const S = bsS();
  // Home Lab's footer is the mockup's 14-unit soft line; Sessions and GPUs keep today's 13-unit dim one.
  const fs = active === 'lab' ? 14 : 13, fc = active === 'lab' ? S.soft : S.dim;
  return bsFrame(`<div data-status="${kioskWorst()}" style="position:absolute;inset:0;font-family:${STM}">` +
    `<div style="position:absolute;left:0;right:0;top:0;height:${kq(6)};background:${status};` +
      (status === S.edge ? '' : `box-shadow:0 0 ${kq(14)} ${status}88;`) + `"></div>` +
    bsHeader(active) + body +
    (foot ? `<div style="position:absolute;left:${kq(28)};right:${kq(28)};bottom:${kq(10)};height:${kq(22)};display:flex;` +
      `justify-content:space-between;gap:${kq(20)};font-size:${kq(fs)};letter-spacing:${kq(3)};color:${fc};white-space:nowrap;` +
      `overflow:hidden;text-transform:uppercase">${foot}</div>` : '') + `</div>`, 'landscape', 'Vintage/Scanlines');
}

/* Host chips: packed, centred, into at most two rows (180 to 264, above the list);
   if the names are too long for that, a fixed 6 x 2 grid that always holds twelve
   (names cut short). */
const SCAN_CHIP = { fs: 19, h: 38, pad: 14, gap: 8, W: 968 };
function scanChipW(h) {
  const ch = SCAN_CHIP.fs * 0.56 + 3;
  return 2 * SCAN_CHIP.pad + 4 + 12 + 10 + Array.from(h.name).length * ch + (h.n ? 10 + String(h.n).length * ch : 0);
}
function scanChipRows(hosts) {
  let rows = hosts.length ? 1 : 0, x = 0;
  hosts.forEach(function (h) {
    const w = scanChipW(h);
    if (x && x + SCAN_CHIP.gap + w > SCAN_CHIP.W) { rows++; x = w; } else x += (x ? SCAN_CHIP.gap : 0) + w;
  });
  return rows;
}
function scanChips(L) {
  const S = bsS();
  const R = S.crit, Y = S.warn;
  const grid = scanChipRows(L.hosts) > 2;
  const list = grid && L.hosts.length > 12 ? L.hosts.slice(0, 11) : L.hosts;
  const fs = grid ? 16 : SCAN_CHIP.fs;
  const chip = function (h) {
    const c = h.health === 'down' || h.health === 'crit' ? R : h.health === 'warn' ? Y : h.health === 'unknown' ? S.soft : S.text;
    const quiet = h.health === 'ok' || h.health === 'unknown';
    const dot = h.up === true ? S.a2 : h.up === false ? R : null;
    return `<span data-host="${esc(h.name)}" data-up="${h.up}" data-health="${h.health}" style="display:inline-flex;align-items:center;` +
        `gap:${kq(grid ? 8 : 10)};height:${kq(grid ? 34 : SCAN_CHIP.h)};padding:0 ${kq(grid ? 10 : SCAN_CHIP.pad)};border:${kq(2)} solid ${quiet ? '#1f4a44' : c};` +
        `font-size:${kq(fs)};letter-spacing:${kq(3)};color:${c};white-space:nowrap;min-width:0;box-sizing:border-box;${S.glowFn(fs, c)}">` +
      `<span style="width:${kq(12)};height:${kq(12)};flex:none;border-radius:50%;background:${dot || S.track};` +
        (dot ? `box-shadow:0 0 ${kq(8)} ${dot}` : '') + `"></span>` +
      `<span style="${grid ? 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis' : ''}">${esc(h.name.toUpperCase())}</span>` +
      (h.n ? `<span style="flex:none;font-weight:700;color:${c}">${h.n}</span>` : '') + `</span>`;
  };
  const extra = L.hosts.length - list.length;
  const html = grid
    ? `<div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:${kq(8)}">${list.map(chip).join('')}` +
      (extra ? `<span style="display:flex;align-items:center;justify-content:center;font-size:${kq(16)};letter-spacing:${kq(3)};color:${S.soft}">+${extra} HOSTS</span>` : '') + `</div>`
    : `<div style="display:flex;flex-wrap:wrap;gap:${kq(8)};justify-content:center">${list.map(chip).join('')}</div>`;
  return html;
}

function scanHomelab(c) {
  const S = scanSkin(3, 0.2);
  const L = kioskLab(), H = kioskH();
  const Y = S.warn, R = S.crit, G = S.a1, BL = S.a2;
  const pending = L.mode === 'pending', unconf = L.mode === 'unconfigured';
  const cond = unconf ? ['HOME LAB NOT CONFIGURED', S.soft] : pending ? ['ACQUIRING TELEMETRY', S.soft]
    : L.stale ? ['TELEMETRY STALE', Y] : L.mode === 'crit' ? ['RED ALERT', R] : L.mode === 'warn' ? ['YELLOW ALERT', Y]
    : ['ALL SYSTEMS NOMINAL', G];
  const chips = unconf ? '' : scanChips(L);
  // The list starts under the second chip row (the mockup's 262), whether there are one or two.
  const top = 262;
  const AH = H - 252 - 40;   // the mockup's list height: its last row sits just over the footer
  const n = L.issues.length, lay = kioskIssueLayout(n, AH);
  const sc = function (i) { return i.severity === 'crit' ? R : Y; };
  const item = function (i, k) {
    return lay.big
      ? `<div data-alert="${k}" style="display:grid;grid-template-columns:${kq(10)} 1fr auto;gap:0 ${kq(14)};align-items:center;height:${kq(lay.rowH)}">` +
          `<span style="align-self:stretch;margin:${kq(6)} 0;background:${sc(i)};box-shadow:0 0 ${kq(10)} ${sc(i)}"></span>` +
          `<div style="min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="font-size:${kq(17)};letter-spacing:${kq(3)};color:${sc(i)};${S.glowFn(17, sc(i))}">${esc(String(i.host).toUpperCase())}</span> ` +
          `<span style="font-size:${kq(25)};color:${S.text};${S.glowFn(25, S.text)}">${esc(i.title)}</span></div>` +
          `<div style="font-size:${kq(15)};color:${S.soft};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.detail || '')}</div></div>` +
          `<span style="font-size:${kq(18)};letter-spacing:${kq(3)};color:${BL};white-space:nowrap;${S.glowFn(18, BL)}">SINCE ${hlClock(i.since)}</span></div>`
      : `<div data-alert="${k}" style="display:grid;grid-template-columns:${kq(8)} ${kq(112)} 1fr ${kq(56)};gap:0 ${kq(10)};align-items:center;height:${kq(lay.rowH)}">` +
          `<span style="align-self:stretch;margin:${kq(4)} 0;background:${sc(i)};box-shadow:0 0 ${kq(8)} ${sc(i)}"></span>` +
          `<span style="font-size:${kq(15)};letter-spacing:${kq(2)};color:${sc(i)};white-space:nowrap;overflow:hidden">${esc(String(i.host).toUpperCase())}</span>` +
          `<span style="font-size:${kq(19)};color:${S.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${S.glowFn(19, S.text)}">${esc(i.title)}</span>` +
          `<span style="font-size:${kq(16)};color:${BL};text-align:right">${hlClock(i.since)}</span></div>`;
  };
  const shown = L.issues.slice(0, lay.shown);
  const moreCell = lay.more ? `<div style="display:flex;align-items:center;font-size:${kq(17)};letter-spacing:${kq(3)};color:${S.soft}">+${lay.more} MORE</div>` : '';
  const list = pending || unconf ? ''
    : !n ? `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:${kq(22)};letter-spacing:${kq(6)};color:${S.soft}">NO OPEN ALERTS</div>`
    : lay.cols === 1 ? shown.map(item).join('')
    : `<div style="display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:column;grid-template-rows:repeat(${lay.rows},${kq(lay.rowH)});gap:0 ${kq(24)}">` +
      shown.map(item).join('') + moreCell + `</div>`;
  const dim = L.stale ? 'opacity:0.55;' : '';
  const body =
    `<div style="position:absolute;left:${kq(28)};right:${kq(28)};top:${kq(112)};text-align:center;font-size:${kq(54)};letter-spacing:${kq(12)};` +
      `white-space:nowrap;color:${cond[1]};${S.glowFn(54, cond[1])}">${cond[0]}</div>` +
    `<div style="position:absolute;left:${kq(28)};right:${kq(28)};top:${kq(180)};${dim}">${chips}</div>` +
    `<div style="position:absolute;left:${kq(28)};right:${kq(28)};top:${kq(top)};height:${kq(AH)};overflow:hidden;${dim}">${list}</div>`;
  const ck = L.checkedAt ? 'CHECKED ' + sessAge(L.checkedAt) + ' AGO' : 'NOT CHECKED YET';
  const crit = L.counts.crit + L.counts.down;
  const foot = unconf ? '' : `<span>${ck} · ${L.hosts.length} HOSTS</span><span><span style="color:${G}">${L.counts.ok} HEALTHY</span> · ` +
    `<span style="color:${Y}">${L.counts.warn} WARN</span> · <span style="color:${crit ? R : S.soft}">${crit} CRIT</span></span>`;
  return scanFrame('lab', cond[1], body, foot);
}

/* Sessions: today's rows and headings, the capacity the spec asks for (five at 576,
   more in a taller frame, "+N MORE" never taking a row), the counts in the footer. */
function scanSessions(c) {
  const S = scanSkin(3, 0.2);
  const D = kioskSess(), H = kioskH();
  const ROW = 64, GAP = 8, TOP = 118, FOOT = 40;
  const bodyH = H - TOP - FOOT, rowsH = bodyH - 34;
  const f = kioskFit(D.list.length, Math.floor((rowsH + GAP) / (ROW + GAP)), Math.floor((rowsH - 27 + GAP) / (ROW + GAP)));
  const shown = D.list.slice(0, f.shown);
  const rowH = f.more ? ROW : Math.min(80, Math.max(ROW, Math.floor((rowsH * 0.8 + GAP) / Math.max(1, shown.length) - GAP)));
  const note = function (text, color, size) {
    return `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:${color};` +
      `font-size:${kq(size)};letter-spacing:${S.ls};text-transform:uppercase;${S.glowFn(14, color)}">${text}</div>`;
  };
  const off = D.status === 'offline';
  let body;
  if (D.status === 'unconfigured') body = note('SESSION FEED NOT CONFIGURED', S.dim, 34);
  else if (D.status === 'pending') body = note('CONNECTING TO SESSION FEED', S.dim, 34);
  else if (!D.list.length) body = off ? note('SESSION FEED OFFLINE', S.warn, 40) : note('NO ACTIVE SESSIONS', S.dim, 40);
  else {
    body = bsSessionHeadings() + `<div style="display:flex;flex-direction:column;gap:${kq(GAP)};${off ? 'opacity:0.45;' : ''}">` +
      shown.map(function (s, k) { return `<div data-session="${k}">${bsSessionRow(s, rowH)}</div>`; }).join('') + `</div>` +
      (f.more ? `<div style="color:${S.label};font-size:${kq(17)};letter-spacing:${S.ls};padding:${kq(10)} ${kq(16)} 0 ${kq(52)}">+${f.more} MORE</div>` : '');
  }
  const left = off ? `<span style="color:${S.warn}">SESSION FEED OFFLINE · LAST UPDATE ${D.checkedAt ? hlClock(D.checkedAt) : 'NEVER'}</span>`
    : D.status === 'ok' ? `<span>FEED LIVE${D.host ? ' · ' + esc(D.host) : ''}</span>` : '<span></span>';
  const right = D.status === 'ok' || off
    ? `<span>${D.list.length} ACTIVE · <span style="color:${D.waiting ? S.warn : S.dim}">${D.waiting} NEEDS INPUT</span></span>` : '';
  return scanFrame('sessions', sessStatusColor(D),
    `<div style="position:absolute;left:${kq(28)};right:${kq(28)};top:${kq(TOP)};height:${kq(bodyH)};overflow:hidden">${body}</div>`,
    left + right);
}

/* GPUs: today's rows in the Scanlines colours (the skin's gpuState). Rows tighten
   from 64 to 48 (the mockup), then as far as needed so eight always show. */
function scanGpus(c) {
  const S = scanSkin(2, 0.12);
  const d = gpuHouseData(), H = kioskH();
  const GAP = 6, TOP = 118, FOOT = 40, BANNER = d.stale ? 34 : 0, MORE = 27;
  const bodyH = H - TOP - FOOT, rowsH = bodyH - 34 - BANNER;
  const n = d.rows.length;
  const fits = function (row, room) { return Math.max(1, Math.floor((room + GAP) / (row + GAP))); };
  let ROW = 64;
  if (fits(ROW, rowsH) < n) ROW = 48;
  if (fits(ROW, rowsH) < n && fits(ROW, rowsH - MORE) < Math.min(n, 8)) ROW = Math.floor((rowsH - MORE + GAP) / 8) - GAP;
  const f = kioskFit(n, fits(ROW, rowsH), fits(ROW, rowsH - MORE));
  const shown = d.rows.slice(0, f.shown);
  const rowH = f.more || ROW < 64 ? ROW
    : Math.min(80, Math.max(ROW, Math.floor((rowsH * 0.8 + GAP) / Math.max(1, shown.length) - GAP)));
  const empty = gpuEmptyNote(d);
  const banner = d.stale ? `<div style="height:${kq(BANNER)};flex-shrink:0;color:${S.warn};font-size:${kq(18)};letter-spacing:${S.ls};` +
    `${S.glowFn(18, S.warn)}">TELEMETRY STALE · LAST UPDATE ${d.pub ? sessAge(d.pub) + ' AGO' : 'NEVER'}</div>` : '';
  const body = empty
    ? banner + `<div style="height:${kq(bodyH - BANNER)};display:flex;align-items:center;justify-content:center;text-align:center;` +
        `color:${empty[1]};font-size:${kq(34)};letter-spacing:${S.ls};${S.glowFn(14, empty[1])}">${empty[0]}</div>`
    : banner + bsGpuHeadings(GPU_COLS, 34, 11.5) + `<div style="display:flex;flex-direction:column;gap:${kq(GAP)}">` +
      shown.map(function (r) { return bsGpuRow(d, r, rowH, rowH / 64, GPU_COLS, false); }).join('') + `</div>` +
      (f.more ? `<div style="color:${S.label};font-size:${kq(17)};letter-spacing:${S.ls};padding:${kq(6)} ${kq(16)} 0 ${kq(52)}">+${f.more} MORE</div>` : '');
  return scanFrame('gpus', gpuStatusColor(d),
    `<div style="position:absolute;left:${kq(28)};right:${kq(28)};top:${kq(TOP)};height:${kq(bodyH)};overflow:hidden">${body}</div>`,
    empty ? '' : `<span style="overflow:hidden;text-overflow:ellipsis">${gpuFooterText(d)}</span>`);
}

function scanNotice(c) {
  const S = scanSkin(3, 0.2);
  return scanFrame('', S.edge,
    `<div style="position:absolute;left:${kq(28)};right:${kq(28)};top:${kq(200)};text-align:center">` +
      `<div style="font-size:${kq(54)};letter-spacing:${kq(12)};color:${S.soft};${S.glowFn(54, S.soft)}">NO SCREENS TO SHOW</div>` +
      `<div style="margin-top:${kq(24)};font-size:${kq(19)};letter-spacing:${kq(4)};color:${S.dim}">CHOOSE SCREENS IN THE CONTROL PANEL</div></div>`, '');
}

/* ================================ VFD ================================ */
/* Today's VFD skin (Share Tech Mono, its colours, glow and filament overlay) with lit
   legends: every word a state could be is printed, and the one that applies is lit.
   Lit text carries data-lit; where a state shows is marked data-cond (Home Lab's
   condition) or data-state (a session's or a GPU's), so the checks look only there. */
const VFD_K = { kHour: _VF.green || '#00DDAA', kSec: _VF.amber || '#FFAA22', kDay: _VF.amber || '#FFAA22',
                kDate: _VF.green || '#00DDAA' };
const VF = { g: _VF.green || '#00DDAA', gb: _VF.greenBright || '#44FFCC', gd: _VF.greenDim || '#008866',
             a: _VF.amber || '#FFAA22', ad: _VF.amberDim || '#886611', b: _VF.blue || '#00D4CC', bd: _VF.blueDim || '#007A77',
             r: _VF.red || '#FF4433', y: _VF.yellow || '#DDCC00', ghost: '#13241e' };
/* Lit and unlit text. `t` is markup (already escaped). */
function vt(t, sz, c, ls) {
  return `<span data-lit style="font-family:${STM};font-size:${kq(sz)};letter-spacing:${kq(ls == null ? 2 : ls)};color:${c};` +
    `text-shadow:0 0 ${kq(Math.max(2, Math.round(sz / 3)))} ${c},0 0 ${kq(Math.round(sz / 3 * 2.5))} ${c}44">${t}</span>`;
}
function vghost(t, sz, ls) {
  return `<span style="font-family:${STM};font-size:${kq(sz)};letter-spacing:${kq(ls == null ? 2 : ls)};color:${VF.ghost}">${t}</span>`;
}
function vleg(words, on, c, sz) {
  return words.map(function (w) { return w === on ? vt(w, sz || 16, c, 3) : vghost(w, sz || 16, 3); })
    .join(`<span style="display:inline-block;width:${kq(14)}"></span>`);
}
function vfdSkin() { return kioskSkinFrom('vfd-k', BS_SKIN_VFD, VFD_K); }
function vfdUp(s) { return esc(String(s == null ? '' : s).toUpperCase()); }

function vfdFrame(active, body) {
  vfdSkin();
  const D = kioskClock();
  const tabs = kioskMenu(active).map(function (t) {
    const c = t.active ? VF.g : t.live ? (t.att === 'crit' ? VF.r : t.att === 'warn' ? VF.a : VF.b) : null;
    const label = vfdUp(t.label), sz = t.built ? 17 : 11;
    return `<span${kioskTabAttrs(t)} style="display:inline-flex;align-items:center;height:${kq(30)};padding:0 ${kq(7)};` +
      `border:${kq(1.5)} solid ${c || VF.ghost};border-radius:${kq(3)};` +
      (c ? `box-shadow:0 0 ${kq(6)} ${c}55,inset 0 0 ${kq(6)} ${c}33` : '') + `">` +
      (c ? vt((t.active ? '▶ ' : '') + label, sz, c, 2) : vghost(label, sz, t.built ? 2 : 1)) + `</span>`;
  }).join('');
  return bsFrame(`<div data-status="${kioskWorst()}" style="position:absolute;inset:0;font-family:${STM}">` +
    `<div style="position:absolute;left:${kq(24)};top:${kq(22)};right:${kq(232)};display:flex;gap:${kq(5)};white-space:nowrap;overflow:hidden">${tabs}</div>` +
    `<div style="position:absolute;right:${kq(24)};top:${kq(8)};text-align:right;line-height:1">${vt(D.hm, 62, VF.g, 4)}` +
      `<div style="margin-top:${kq(4)}">${vt(D.day, 15, VF.a, 4)} ${vt(D.short.slice(4) + ' ' + D.year, 15, VF.b, 3)}</div></div>` +
    `<div style="position:absolute;left:${kq(24)};right:${kq(24)};top:${kq(96)};height:1px;background:linear-gradient(90deg,transparent,${VF.g}33,${VF.a}33,${VF.b}33,transparent)"></div>` +
    `<div style="position:absolute;left:${kq(24)};right:${kq(24)};top:${kq(108)};bottom:${kq(12)}">${body}</div></div>`,
    'landscape', 'Vintage/VFD');
}
function vfdNote(text, c, sz) {
  return `<div style="height:100%;display:flex;align-items:center;justify-content:center;text-align:center">${vt(text, sz || 30, c, 4)}</div>`;
}

function vfdHomelab(c) {
  const L = kioskLab(), H = kioskH();
  if (L.mode === 'unconfigured') return vfdFrame('lab', vfdNote('HOME LAB NOT CONFIGURED', VF.gd));
  const pending = L.mode === 'pending';
  if (pending && !L.hosts.length) return vfdFrame('lab', vfdNote('ACQUIRING TELEMETRY', VF.gd));
  const crit = L.counts.crit + L.counts.down, warn = L.counts.warn;
  const big = function (n, lab, col, on) {
    return `<div style="line-height:1">${on ? vt(lab, 15, col, 3) : vghost(lab, 15, 3)}` +
      `<div>${on ? vt(String(n).padStart(2, ' '), 58, col, 4) : vghost(String(n).padStart(2, '0'), 58, 4)}</div></div>`;
  };
  const on = pending ? null : L.stale ? 'CAUTION' : L.mode === 'crit' ? 'ALERT' : L.mode === 'warn' ? 'CAUTION' : 'NORMAL';
  const onC = on === 'ALERT' ? VF.r : on === 'CAUTION' ? VF.a : VF.g;
  const age = L.checkedAt ? sessAge(L.checkedAt) + ' AGO' : 'NEVER';
  const checked = pending ? vt('ACQUIRING TELEMETRY', 14, VF.gd, 3)
    : L.stale ? vt('STALE · CHECKED ' + age, 14, VF.a, 3) : vt('CHECKED ' + age, 14, VF.gd, 3);
  const list12 = L.hosts.length > 12 ? L.hosts.slice(0, 11) : L.hosts;
  const hostCol = function (h) { return h.health === 'ok' ? VF.g : h.health === 'warn' ? VF.a : h.health === 'unknown' ? VF.gd : VF.r; };
  const hosts = list12.map(function (h) {
    const col = hostCol(h);
    const upMark = h.up === true ? vt('▲', 16, VF.b) : h.up === false ? vt('▼', 16, VF.r) : vghost('△', 16);
    const st = h.health === 'ok' ? vt('OK', 15, VF.gd, 3) : h.health === 'warn' ? vt('WARN', 15, VF.a, 3)
      : h.health === 'crit' ? vt('ALERT', 15, VF.r, 3) : h.health === 'down' ? vt('DOWN', 15, VF.r, 3) : vt('--', 15, VF.gd, 3);
    return `<div data-host="${esc(h.name)}" data-up="${h.up}" data-health="${h.health}" style="display:flex;align-items:center;gap:${kq(10)};height:${kq(30)}">` +
      upMark + ` <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${vt(vfdUp(h.name), 19, col)}</span>` +
      st + (h.n && h.health !== 'ok' ? ' ' + vt(String(h.n), 15, h.health === 'warn' ? VF.a : VF.r) : '') + `</div>`;
  }).join('') + (L.hosts.length > list12.length ? `<div style="display:flex;align-items:center;height:${kq(30)}">${vt('+' + (L.hosts.length - list12.length) + ' HOSTS', 15, VF.gd, 3)}</div>` : '');
  const gridRows = Math.ceil(Math.min(L.hosts.length, 12) / 3);
  const AH = H - 120 - 118 - 32 * gridRows;
  const n = L.issues.length, lay = kioskIssueLayout(n, AH);
  const sev = function (i) { return i.severity === 'crit' ? VF.r : VF.a; };
  const item = function (i, k) {
    return lay.big
      ? `<div data-alert="${k}" style="display:grid;grid-template-columns:${kq(130)} 1fr auto;gap:0 ${kq(14)};align-items:center;height:${kq(lay.rowH)}">` +
          `<span style="white-space:nowrap;overflow:hidden">${vt(vfdUp(i.host), 19, sev(i))}</span>` +
          `<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${vt(vfdUp(i.title), 22, sev(i))}</span>${vt(hlClock(i.since), 30, VF.b, 3)}</div>`
      : `<div data-alert="${k}" style="display:grid;grid-template-columns:${kq(100)} 1fr ${kq(60)};gap:0 ${kq(10)};align-items:center;height:${kq(lay.rowH)}">` +
          `<span style="white-space:nowrap;overflow:hidden">${vt(vfdUp(i.host), 15, sev(i), 1)}</span>` +
          `<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${vt(vfdUp(i.title), 17, sev(i), 1)}</span>` +
          `<span style="text-align:right">${vt(hlClock(i.since), 17, VF.b, 1)}</span></div>`;
  };
  const shown = L.issues.slice(0, lay.shown);
  const list = pending ? ''
    : !n ? `<div style="height:100%;display:flex;align-items:center;justify-content:center">${vt('NO OPEN ALERTS', 17, VF.gd, 3)}</div>`
    : lay.cols === 1 ? shown.map(item).join('')
    : `<div style="display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:column;grid-template-rows:repeat(${lay.rows},${kq(lay.rowH)});gap:0 ${kq(24)}">` +
      shown.map(item).join('') + (lay.more ? `<div style="display:flex;align-items:center">${vt('+' + lay.more + ' MORE', 16, VF.gd, 3)}</div>` : '') + `</div>`;
  const dim = L.stale ? 'opacity:0.55;' : '';
  return vfdFrame('lab',
    `<div style="display:flex;align-items:flex-end;gap:${kq(30)}">${big(L.hosts.length, 'HOSTS', VF.g, !pending)}${big(L.counts.ok, 'HEALTHY', VF.g, !pending)}` +
      `${big(warn, 'WARN', VF.a, warn)}${big(crit, 'ALERT', VF.r, crit)}` +
      `<div data-cond style="margin-left:auto;text-align:right;line-height:1.7">${vleg(['NORMAL', 'CAUTION', 'ALERT'], on, onC, 17)}<br>${checked}</div></div>` +
    `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:${kq(2)} ${kq(36)};margin-top:${kq(10)};${dim}">${hosts}</div>` +
    `<div style="margin-top:${kq(10)};border-top:1px solid #1a1a16;padding-top:${kq(6)};height:${kq(AH)};overflow:hidden;${dim}">${list}</div>`);
}

function vfdSessions(c) {
  const D = kioskSess(), H = kioskH();
  const off = D.status === 'offline';
  if (D.status === 'unconfigured') return vfdFrame('sessions', vfdNote('SESSION FEED NOT CONFIGURED', VF.gd));
  if (D.status === 'pending') return vfdFrame('sessions', vfdNote('CONNECTING TO SESSION FEED', VF.gd));
  if (!D.list.length) return vfdFrame('sessions', off ? vfdNote('SESSION FEED OFFLINE', VF.a) : vfdNote('NO ACTIVE SESSIONS', VF.gd));
  const col = { waiting: VF.a, busy: VF.g, shell: VF.b, idle: VF.gd };
  const leg = { waiting: 'INPUT', busy: 'WORK', shell: 'SHELL', idle: 'IDLE' };
  // Natural and minimum row heights (a waiting session's message takes a third line).
  // Rows keep their natural height while at least five fit (the mockup); otherwise they
  // shrink only as far as it takes to show five.
  const msg = function (s) { return s.state === 'waiting' && s.message; };
  const nat = function (s) { return msg(s) ? 88 : 76; }, min = function (s) { return msg(s) ? 70 : 60; };
  const B = H - 108 - 12 - 30;
  const count = function (h) {
    let k = 0, used = 0;
    while (k < D.list.length && used + h(D.list[k]) <= B) { used += h(D.list[k]); k++; }
    return k;
  };
  const kNat = count(nat);
  const k = kNat >= Math.min(5, D.list.length) ? kNat : Math.min(count(min), 5);
  const shown = D.list.slice(0, k), more = D.list.length - k;
  const sumN = shown.reduce(function (a, s) { return a + nat(s); }, 0);
  const sumM = shown.reduce(function (a, s) { return a + min(s); }, 0);
  const height = function (s) {
    return sumN <= B ? nat(s) : min(s) + Math.floor((B - sumM) * (nat(s) - min(s)) / Math.max(1, sumN - sumM));
  };
  const rows = shown.map(function (s, i) {
    const st = col[s.state] ? s.state : 'idle';
    return `<div data-session="${i}" style="display:grid;grid-template-columns:minmax(0,1fr) ${kq(290)} ${kq(120)} ${kq(56)} ${kq(100)};gap:0 ${kq(16)};` +
        `align-items:center;height:${kq(height(s))};border-bottom:1px solid #15150f">` +
      `<div style="min-width:0;line-height:1.25"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">` +
        `${vt(vfdUp(s.name), 25, st === 'waiting' ? VF.a : st === 'idle' ? VF.gd : VF.g)}</div><div style="white-space:nowrap;overflow:hidden">${vt(vfdUp(s.project), 14, VF.bd)}</div>` +
        (msg(s) ? `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${vt(vfdUp(s.message), 13, VF.a, 1)}</div>` : '') + `</div>` +
      `<div data-state>${vleg(['INPUT', 'WORK', 'SHELL', 'IDLE'], leg[st], col[st], 16)}</div>` +
      `<div style="text-align:right">${vt(kioskTok(s.tokens), 30, VF.g)}</div>` +
      `<div style="text-align:center">${vt(s.agents ? esc(s.agents) : '--', 30, VF.b)}</div>` +
      `<div style="text-align:right">${vt(sessAge(s.since).split(' ')[0].toUpperCase(), 30, st === 'waiting' ? VF.a : VF.g)}</div></div>`;
  }).join('');
  const left = (more ? '+' + more + ' MORE · ' : '') + (off ? 'SESSION FEED OFFLINE · LAST UPDATE ' + (D.checkedAt ? hlClock(D.checkedAt) : 'NEVER')
    : 'FEED LIVE' + (D.host ? ' · ' + vfdUp(D.host) : ''));
  return vfdFrame('sessions', `<div style="${off ? 'opacity:0.45' : ''}">${rows}</div>` +
    `<div style="margin-top:${kq(8)};display:flex;justify-content:space-between;gap:${kq(16)};white-space:nowrap">${vt(left, 15, off ? VF.a : VF.gd, 3)}` +
      `${vt(D.list.length + ' ACTIVE · ' + D.waiting + ' NEEDS INPUT', 15, D.waiting ? VF.a : VF.gd, 3)}</div>`);
}

/* A big row's legend; smaller rows light the state's full word (GPU_LABEL). */
const VFD_GPU_WORD = { busy: 'BUSY', idle: 'IDLE', throttling: 'THROT', hot: 'HOT', critical: 'HOT' };
function vfdGpus(c) {
  const G = kioskGpus(), H = kioskH();
  const empty = gpuEmptyNote(G);
  const banner = G.stale ? `<div style="height:${kq(30)}">${vt('TELEMETRY STALE · LAST UPDATE ' + (G.pub ? sessAge(G.pub) + ' AGO' : 'NEVER'), 15, VF.a, 3)}</div>` : '';
  if (empty) return vfdFrame('gpus', banner + `<div style="height:${kq(H - 120 - (G.stale ? 30 : 0))}">${vfdNote(empty[0], empty[1] === bsS().warn ? VF.a : VF.gd, 26)}</div>`);
  const n = G.rows.length;
  const B = H - 108 - 12 - 30 - (G.stale ? 30 : 0);
  const f = kioskFit(n, Math.floor(B / 40), Math.floor((B - 24) / 40));
  const shown = G.rows.slice(0, f.shown);
  const rowH = Math.min(104, Math.floor((B - (f.more ? 24 : 0)) / Math.max(1, shown.length)));
  const form = rowH >= 80 ? 'big' : rowH >= 56 ? 'normal' : 'compact';
  const rows = shown.map(function (r) {
    const st = r.state;
    const sc = st === 'throttling' || st === 'hot' ? VF.a : st === 'critical' ? VF.r : st === 'busy' ? VF.g
      : (st === 'offline' || st === 'unreadable') ? VF.a : VF.gd;
    const word = VFD_GPU_WORD[st];
    const seen = r.fresh ? '' : ' ' + vt('SEEN ' + (r.seen_at ? sessAge(r.seen_at) : '--') + ' AGO', 11, VF.gd, 1);
    const stateBox = `<div data-state style="${form === 'compact' ? 'display:inline-block' : ''}">` +
      (form === 'big' && word ? vleg(['BUSY', 'IDLE', 'THROT', 'HOT'], word, sc, 12) : vt(GPU_LABEL[st] || 'UNKNOWN', 12, sc, 2)) + seen + `</div>`;
    const title = vfdUp(r.host) + ' ' + r.index;
    const nameCell = form === 'compact'
      ? `<div style="white-space:nowrap;overflow:hidden;line-height:1">${vt(title, 17, VF.g)} ${stateBox}</div>`
      : `<div style="line-height:1.2;min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-left:-${kq(10)};padding-left:${kq(10)}">${vt(title, form === 'big' ? 23 : 19, VF.g)}</div>` +
        `<div style="white-space:nowrap;overflow:hidden">${vt(esc(r.short), 13, VF.bd)}</div>${stateBox}</div>`;
    const util = gpuFin(r.util), temp = gpuFin(r.temp), pw = gpuFin(r.power), lim = gpuFin(r.power_limit), mt = gpuFin(r.mem_temp);
    const used = gpuFin(r.vram_used), tot = gpuFin(r.vram_total);
    const vpct = used !== null && tot !== null && tot > 0 ? Math.max(0, Math.min(100, used / tot * 100)) : null;
    const vtext = vpct === null ? '--' : (used / 1024).toFixed(1) + '/' + Math.round(tot / 1024) + 'G';
    const bh = form === 'big' ? 16 : form === 'normal' ? 12 : 10;
    const meter = function (label, pct, color) {
      return `<div style="min-width:0">${vt(label, 14, VF.bd)}<div style="margin-top:${kq(4)}">${BS_SKIN_VFD.barFn(pct === null ? 0 : pct, color, 250, bh)}</div></div>`;
    };
    const tsz = form === 'big' ? 44 : form === 'normal' ? 34 : 26;
    const memOk = mt !== null && mt >= -50 && mt <= 200;
    const tempCell = `<div style="text-align:right;line-height:1">${vt(temp === null ? '--' : Math.round(temp) + '&deg;', tsz, temp === null ? VF.gd : temp >= 85 ? VF.r : temp >= 70 ? VF.y : VF.g)}` +
      (memOk ? `<div data-mem${form === 'compact' ? ' style="line-height:1.1"' : ''}>${vt('MEM ' + Math.round(mt) + '&deg;', form === 'compact' ? 11 : 13, mt >= 85 ? VF.a : VF.gd)}</div>` : '') + `</div>`;
    const psz = form === 'big' ? 38 : form === 'normal' ? 30 : 24;
    const powCell = `<div style="text-align:right;line-height:1">${pw === null ? vt('--', psz, VF.gd) : vt(String(Math.round(pw)), psz, VF.a) + vt('W', 14, VF.ad)}` +
      (lim !== null && form !== 'compact' ? `<div>${vt('OF ' + Math.round(lim) + ' W', 12, VF.ad)}</div>` : '') + `</div>`;
    return `<div data-gpu-row="${esc(r.host)}|${r.index}" style="display:grid;grid-template-columns:${kq(170)} minmax(0,1fr) minmax(0,1fr) ${kq(110)} ${kq(120)};` +
        `gap:0 ${kq(18)};align-items:center;height:${kq(rowH)};border-bottom:1px solid #15150f;${r.fresh ? '' : 'opacity:0.6;'}">` +
      nameCell + meter('LOAD ' + (util === null ? '--' : Math.round(util) + '%'), util, util !== null && util > 80 ? VF.a : VF.g) +
      meter('VRAM ' + vtext, vpct, VF.b) + tempCell + powCell + `</div>`;
  }).join('');
  return vfdFrame('gpus', banner + rows +
    (f.more ? `<div style="height:${kq(24)};display:flex;align-items:center">${vt('+' + f.more + ' MORE', 16, VF.gd, 3)}</div>` : '') +
    `<div style="margin-top:${kq(6)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${vt(gpuFooterText(G), 15, VF.gd, 3)}</div>`);
}

function vfdNotice(c) {
  return vfdFrame('', `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${kq(20)}">` +
    vt('NO SCREENS TO SHOW', 40, VF.gd, 6) + vt('CHOOSE SCREENS IN THE CONTROL PANEL', 16, VF.bd, 3) + `</div>`);
}

const RETRO_RENDERERS = {
  'Vintage/Scanlines': { lab: scanHomelab, sessions: scanSessions, gpus: scanGpus, notice: scanNotice, fluid: 'landscape' },
  'Vintage/VFD': { lab: vfdHomelab, sessions: vfdSessions, gpus: vfdGpus, notice: vfdNotice, fluid: 'landscape' },
};
Object.assign(KIOSK_RENDERERS, RETRO_RENDERERS);
