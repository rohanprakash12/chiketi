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
  return bsFrame(`<div data-status="${kioskWorst()}" style="position:absolute;inset:0;font-family:${STM};font-size:${kq(16)}">` +
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
/* Lit and unlit text. `t` is markup (already escaped). The font is named alone, as
   the mockup: glyphs it lacks (the up/down triangles) fall back to the browser's
   default face, not a monospace one. */
const VFD_FONT = "'Share Tech Mono'";
function vt(t, sz, c, ls) {
  return `<span data-lit style="font-family:${VFD_FONT};font-size:${kq(sz)};letter-spacing:${kq(ls == null ? 2 : ls)};color:${c};` +
    `text-shadow:0 0 ${kq(Math.max(2, Math.round(sz / 3)))} ${c},0 0 ${kq(Math.round(sz / 3 * 2.5))} ${c}44">${t}</span>`;
}
function vghost(t, sz, ls) {
  return `<span style="font-family:${VFD_FONT};font-size:${kq(sz)};letter-spacing:${kq(ls == null ? 2 : ls)};color:${VF.ghost}">${t}</span>`;
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
  return bsFrame(`<div data-status="${kioskWorst()}" style="position:absolute;inset:0;font-family:${STM};font-size:${kq(16)}">` +
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
  // A host row's width, as an upper bound: the triangle (a fallback glyph, 1.25 em),
  // the name, the health word and count, and the flex gaps between them.
  const vfdHostW = function (h) {
    const st = { ok: 'OK', warn: 'WARN', crit: 'ALERT', down: 'DOWN' }[h.health] || '--';
    const count = h.n && h.health !== 'ok' ? String(h.n) : '';
    return 1.25 * 16 + 2 + kioskTextW(h.name, 'stm', 19, 2) + kioskTextW(st, 'stm', 15, 3) +
      (count ? kioskTextW(count, 'stm', 15, 2) + 10 : 0) + 20;
  };
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
    `<div style="display:grid;grid-template-columns:${kioskCols(list12.map(vfdHostW).concat(L.hosts.length > list12.length ? [kioskTextW('+' + (L.hosts.length - list12.length) + ' HOSTS', 'stm', 15, 3)] : []), 904)};gap:${kq(2)} ${kq(36)};margin-top:${kq(10)};${dim}">${hosts}</div>` +
    `<div style="margin-top:${kq(10)};border-top:1px solid #1a1a16;padding-top:${kq(6)};${dim}"><div style="height:${kq(AH)};overflow:hidden">${list}</div></div>`);
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
  // Big and normal rows keep the mockup's line boxes (a big row's legend wraps to a
  // second line); compact rows set their own, tighter ones.
  const form = rowH >= 88 ? 'big' : rowH >= 63 ? 'normal' : 'compact';
  const rows = shown.map(function (r) {
    const st = r.state;
    const sc = st === 'throttling' || st === 'hot' ? VF.a : st === 'critical' ? VF.r : st === 'busy' ? VF.g
      : (st === 'offline' || st === 'unreadable') ? VF.a : VF.gd;
    const word = VFD_GPU_WORD[st];
    // A cached row's age takes the model's line (compact rows: after the state word).
    const age = r.seen_at ? sessAge(r.seen_at) : '--';
    // A big row's legend wraps onto a second line, as the mockup; smaller rows keep one line.
    const stateBox = `<div data-state data-fit style="white-space:${form === 'big' ? 'normal' : 'nowrap'}${form === 'compact' ? ';font-size:' + kq(12) + ';line-height:1.1' : ''}">` +
      (form === 'big' && word ? vleg(['BUSY', 'IDLE', 'THROT', 'HOT'], word, sc, 12) : vt(GPU_LABEL[st] || 'UNKNOWN', 12, sc, 2)) +
      (form === 'compact' && !r.fresh ? ' ' + vt('SEEN ' + age.split(' ')[0].toUpperCase(), 11, VF.gd, 1) : '') + `</div>`;
    const title = vfdUp(r.host) + ' ' + r.index;
    const titleLine = function (sz) {
      return `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-left:-${kq(10)};padding-left:${kq(10)}${form === 'compact' ? ';font-size:' + kq(sz) : ''}">${vt(title, sz, VF.g)}</div>`;
    };
    const nameCell = form === 'compact'
      ? `<div style="line-height:1;min-width:0">${titleLine(17)}${stateBox}</div>`
      : `<div style="line-height:1.2;min-width:0">${titleLine(form === 'big' ? 23 : 19)}` +
        `<div style="white-space:nowrap;overflow:hidden">${r.fresh ? vt(esc(r.short), 13, VF.bd) : vt('SEEN ' + age.toUpperCase() + ' AGO', 13, VF.gd, 1)}</div>${stateBox}</div>`;
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
    const tempCell = `<div style="text-align:right;line-height:1${form === 'compact' ? ';font-size:' + kq(tsz) : ''}">${vt(temp === null ? '--' : Math.round(temp) + '&deg;', tsz, temp === null ? VF.gd : temp >= 85 ? VF.r : temp >= 70 ? VF.y : VF.g)}` +
      (memOk ? `<div data-mem${form === 'compact' ? ' style="font-size:' + kq(11) + ';line-height:1.1"' : ''}>${vt('MEM ' + Math.round(mt) + '&deg;', form === 'compact' ? 11 : 13, mt >= 85 ? VF.a : VF.gd)}</div>` : '') + `</div>`;
    const psz = form === 'big' ? 38 : form === 'normal' ? 30 : 24;
    const powCell = `<div style="text-align:right;line-height:1${form === 'compact' ? ';font-size:' + kq(psz) : ''}">${pw === null ? vt('--', psz, VF.gd) : vt(String(Math.round(pw)), psz, VF.a) + vt('W', 14, VF.ad)}` +
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

/* ================================ Tubes ================================ */
/* A 1940s-50s instrument panel. The panel (steel, plates, screws, fixed legends, blank
   label plates) and the instrument parts (jewel lamps, annunciator windows, IN-12 Nixies,
   IN-13 bargraphs, magic-eye mounts, the tab plate) are Blender renders
   (tools/tube-renders/, served from /assets/tubes/); today's instruments draw the live light
   between each part's back and front layers. Every position comes from TUBES_LAYOUT, which
   is generated from the same layout.py the panels were rendered from. */
const TU = { ink: '#1a0e04', paint: '#DCD1B4', dim: '#8d8470', warm: '#FFC27A', hot: '#FF9C86', steel: '#0b0a09' };
const TU_FIL = { orange: '#FF5A0A', green: '#14FF38', blue: '#2A72FF' };
const TU_FILCORE = { orange: ['#FFCC88', '#FFDDAA'], green: ['#B8FFC4', '#E4FFE8'], blue: ['#B4CCFF', '#E2EBFF'] };
const TU_JC = { amber: '#FF6A00', green: '#22FF3A', red: '#FF2A10', blue: '#2A7BFF', white: '#FFD7A0' };
const TU_PLEX = "'IBM Plex Mono'";

function tubUrl(name) { return '/assets/tubes/' + name + '.webp?v=' + TUBES_HASH; }
/* A rendered part, sized and placed in frame units. */
function tubImg(name, x, y, w, h, css) {
  return `<img src="${tubUrl(name)}" alt="" style="position:absolute;left:${kq(x)};top:${kq(y)};width:${kq(w)};height:${kq(h)};${css || ''}">`;
}
function tAbs(x, y, w, h, inner, css, attrs) {
  return `<div${attrs || ''} style="position:absolute;left:${kq(x)};top:${kq(y)};` + (w != null ? `width:${kq(w)};` : '') +
    (h != null ? `height:${kq(h)};` : '') + `${css || ''}">${inner}</div>`;
}
/* Live lettering in cream paint; lit text (a state, a value) carries data-lit. */
function tubPaint(t, sz, col, css, unlit) {
  return `<span${unlit ? '' : ' data-lit'} style="font-family:${TU_PLEX};font-weight:600;font-size:${kq(sz)};letter-spacing:.14em;text-transform:uppercase;` +
    `white-space:nowrap;color:${col || TU.paint};text-shadow:0 0 ${kq(1)} rgba(0,0,0,.5);${css || ''}">${t}</span>`;
}
/* Lettering on a rendered plate: sized from the raw text, shrunk to fit, never under 9
   units (then cut short), escaped. */
function tubPlate(l, raw, col, base, attrs) {
  const n = Math.max(1, Array.from(String(raw)).length);
  const sz = Math.max(9, Math.min(base || 15, Math.floor((l.w - 22) / (n * 0.74))));
  return tAbs(l.x, l.y, l.w, l.h, tubPaint(esc(String(raw)), sz, col, `overflow:hidden;text-overflow:ellipsis;max-width:${kq(l.w - 14)}`),
    'display:flex;align-items:center;justify-content:center', attrs);
}
function tubJewel(cx, cy, d, col, on) {
  const s = d * 1.1;
  return (on ? tAbs(cx - d * 1.3, cy - d * 1.3, d * 2.6, d * 2.6, '', `border-radius:50%;background:radial-gradient(circle,${TU_JC[col]}88 0%,${TU_JC[col]}33 32%,transparent 66%);mix-blend-mode:plus-lighter`) : '') +
    tubImg('jewel-' + col + '-' + (on ? 'on' : 'off'), cx - s / 2, cy - s / 2, s, s, `filter:drop-shadow(0 ${kq(2)} ${kq(2)} rgba(0,0,0,.7))`);
}
/* One IN-12 Nixie seen end-on, h = escutcheon height; ch '' is an unlit tube. The numeral
   is the bundled Antonio at weight 100, sized and placed from the rendered cathode's
   measured height (TUBES_META.in12), so it lands on the wire. */
function tubNixie(x, y, h, ch) {
  const m = TUBES_META.in12, u = h / m.units_h, w = h * m.w / m.h, F = m.digit_h_units * u / 0.89;
  const glow = ch === '' ? '' :
    tAbs(w * 0.14, h * 0.14, w * 0.72, h * 0.72, '', 'background:radial-gradient(ellipse at 50% 50%,rgba(255,104,16,.40),rgba(255,64,0,.14) 55%,transparent 76%);mix-blend-mode:plus-lighter') +
    tAbs(0, h / 2 - 0.57 * F, w, F, ch, `text-align:center;line-height:${kq(F)};font-family:Antonio;font-weight:100;font-variation-settings:'wght' 100;font-size:${kq(F)};color:#FFD9A6;mix-blend-mode:plus-lighter;` +
      `text-shadow:0 0 ${kq(u * .02)} #FFF2DE,0 0 ${kq(u * .05)} #FFB25C,0 0 ${kq(u * .12)} #FF7A14,0 0 ${kq(u * .28)} rgba(255,84,0,.9),0 0 ${kq(u * .6)} rgba(255,46,0,.55)`);
  return tAbs(x, y, w, h, tubImg('in12-back', 0, 0, w, h) + glow + tubImg('in12-front', 0, 0, w, h), `filter:drop-shadow(0 ${kq(3)} ${kq(3)} rgba(0,0,0,.75))`);
}
/* INS-1 neon lamps: a colon (two, either side of the middle) or a decimal point (one, at
   the foot); h is the Nixie's height. */
function tubNeon(x, y, h, dots) {
  const d = h * 0.07;
  const dot = function (top) {
    return tAbs(0, top, d, d, '', 'border-radius:50%;background:radial-gradient(circle at 45% 40%,#FFF4E2 0%,#FFB45E 38%,#FF6A10 70%,#9a3000 100%);' +
      `box-shadow:0 0 ${kq(3)} #FF8A2A,0 0 ${kq(9)} #FF5A0A,0 0 ${kq(18)} rgba(255,60,0,.55)`);
  };
  return tAbs(x, y, d, h, dots === 2 ? dot(h * 0.38) + dot(h * 0.55) : dot(h * 0.8));
}
/* A row of Nixies for a string like "13:07", "8.8" or "234"; ' ' is an unlit tube. */
function tubNixieRow(x, y, h, str, align) {
  const m = TUBES_META.in12, w = h * m.w / m.h, gap = h * 0.04, cw = h * 0.26, pw = h * 0.16;
  const chars = Array.from(String(str));
  const wid = function (c) { return c === ':' ? cw : c === '.' ? pw : w; };
  const W = chars.reduce(function (a, c) { return a + wid(c) + gap; }, -gap);
  let cx = align === 'r' ? x - W : align === 'c' ? x - W / 2 : x, out = '';
  chars.forEach(function (c) {
    if (c === ':') out += tubNeon(cx + (cw - h * 0.07) / 2, y, h, 2);
    else if (c === '.') out += tubNeon(cx + (pw - h * 0.07) / 2, y, h, 1);
    else out += tubNixie(cx, y, h, /[0-9]/.test(c) ? c : '');
    cx += wid(c) + gap;
  });
  return out;
}
/* IN-13 bargraph, w long, with today's tubeFilament glow inside the rendered glass. */
function tubIn13(x, y, w, pct, col, id) {
  const m = TUBES_META.in13, h = w / 10;
  const gx = (m.glow_x0_units - m.left_x) * m.px_per_unit / m.w * w, gw = (m.glow_x1_units - m.glow_x0_units) * m.px_per_unit / m.w * w;
  const gh = Math.max(4, w * 0.043);
  const svg = tubeFilament(pct === null ? 0 : pct, TU_FIL[col], false, 'tu-' + id, 14)
    .replace(/<rect x="0" y="0"[^>]*\/>/, '').replace(/<line [^>]*\/>/, '')
    .replace('#FFCC88', TU_FILCORE[col][0]).replace('#FFDDAA', TU_FILCORE[col][1])
    .replace('height="14"', 'height="100%"');
  return tAbs(x, y, w, h, tubImg('in13-back', 0, 0, w, h) +
      tAbs(gx, h / 2 - gh / 2, gw, gh, svg, 'display:flex;mix-blend-mode:plus-lighter') +
      tubImg('in13-front', 0, 0, w, h), `filter:drop-shadow(0 ${kq(2)} ${kq(2)} rgba(0,0,0,.7))`);
}
/* Magic eye in its mount (d = bezel diameter, centred on cx, cy); a missing reading reads
   '--' with the eye closed. */
function tubEye(cx, cy, d, pct, id) {
  const s = d * 1.1, S = (0.74 / 2.2 * s) / (146 / 420);
  const eye = magicEye(pct === null ? 0 : pct, '', S, pct === null ? { rich: true, invert: true, id: id, text: '--' } : { rich: true, invert: true, id: id });
  return tAbs(cx - s / 2, cy - s / 2, s, s, tubImg('eye-back', 0, 0, s, s) + tAbs((s - S) / 2, (s - S) / 2, S, S, eye) + tubImg('eye-front', 0, 0, s, s),
    `filter:drop-shadow(0 ${kq(3)} ${kq(4)} rgba(0,0,0,.75))`);
}
/* A backlit annunciator window (rendered frame and frosted glass, 9-slice) with lettering. */
function tubAnn(x, y, w, h, col, inner, bw, attrs) {
  const b = bw || 7;
  return tAbs(x, y, w, h, inner, `box-sizing:border-box;border:${kq(b)} solid transparent;border-image:url(${tubUrl('ann-' + col)}) 32 fill / ${kq(b)} stretch;` +
    `color:${col === 'off' ? '#8a8172' : TU.ink};font-family:${TU_PLEX};font-weight:700;overflow:hidden;` +
    (col === 'off' ? '' : `box-shadow:0 0 ${kq(18)} ${TU_JC[col] || '#FFC070'}40`), attrs);
}
function tubSlot(L, kind, k) {
  return L.slots.filter(function (s) { return s.kind === kind && (k == null || s.k === k); })[0];
}
function tubLabel(L, kind, k) {
  return L.labels.filter(function (l) { return l.kind === kind && (k == null || l.k === k || l.i === k); })[0];
}
/* The rendered height a frame uses: the largest of TUBES_HEIGHTS that fits. */
function tubPanelH(h) {
  let best = TUBES_HEIGHTS[0];
  TUBES_HEIGHTS.forEach(function (t) { if (t <= h) best = t; });
  return best;
}
function tubSkin() { return kioskSkin('tube', TU.steel, PLEX); }
const TU_MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/* The frame: the panel for `variant` at this height, steel below it, the tab row in the
   display's order, the date window and the Nixie clock. Returns [html, layout]. */
function tubFrame(variant, active, body) {
  const H = kioskH(), P = tubPanelH(H), L = TUBES_LAYOUT[variant][String(P)];
  const D = kioskClock(), now = new Date();
  let h = tubImg('panel-' + variant + '-' + P, 0, 0, 1024, P);
  if (H > P) h += tAbs(0, P, 1024, H - P, '', `background:${TU.steel};box-shadow:inset 0 ${kq(1)} ${kq(2)} rgba(0,0,0,.8)`);
  const row = tubSlot(L, 'tabrow');
  let x = row.x;
  kioskMenu(active).forEach(function (t) {
    const label = String(t.label).toUpperCase();
    if (t.built) {
      const on = t.active || !!t.att;
      const col = t.active ? 'green' : t.att === 'crit' ? 'red' : 'amber';
      h += tAbs(x, 0, row.built_w, 92, tubJewel(row.built_w / 2, row.lamp_y, row.d, col, on) +
        tubImg('tabplate', 2, row.plate_y - 2, 80, 26) +
        tubPlate({ x: 4, y: row.plate_y, w: row.plate_w, h: row.plate_h }, label, t.live ? TU.paint : TU.dim, 10),
        '', kioskTabAttrs(t));
      x += row.built_w;
    } else {
      // Two lines, as the mockup: on a space, else a long word hyphenated (OVER-/VIEW).
      const words = label.split(' '), half = Math.ceil(label.length / 2);
      const lines = words.length > 1 ? [words[0], words.slice(1).join(' ')]
        : label.length > 6 ? [label.slice(0, half) + '-', label.slice(half)] : [label];
      h += tAbs(x, 0, row.planned_w, 92, tubJewel(row.planned_w / 2, row.small_lamp_y, row.small_d, 'amber', false) +
        lines.map(function (ln, i) {
          const sz = Math.min(8, Math.floor((row.planned_w - 4) / (Array.from(ln).length * 0.74) * 10) / 10);
          return tAbs(0, row.plate_y - 6 + i * 11, row.planned_w, 11, tubPaint(esc(ln), sz, TU.dim, '', true), 'display:flex;justify-content:center;align-items:center');
        }).join(''), '', kioskTabAttrs(t));
      x += row.planned_w;
    }
  });
  const dt = tubSlot(L, 'date'), ck = tubSlot(L, 'clock');
  h += tubAnn(dt.x, dt.y, dt.w, dt.h, 'white', `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.2">` +
    `<span style="font-size:${kq(13)};letter-spacing:.12em">${D.day}</span><span style="font-size:${kq(15)};letter-spacing:.1em">${TU_MON[now.getMonth()]} ${now.getDate()}</span></div>`);
  h += tubNixieRow(ck.x + 186, ck.y, ck.h, D.hm, 'r');
  return [bsFrame(`<div data-status="${kioskWorst()}" style="position:absolute;inset:0;background:${TU.steel};overflow:hidden;font-size:${kq(16)}">` +
    h + body + `</div>`, 'landscape', 'Vintage/Tubes'), L];
}
/* Two passes: the layout comes from the frame, the body from the layout. */
function tubScreen(variant, active, bodyFn) {
  tubSkin();
  const P = tubPanelH(kioskH()), L = TUBES_LAYOUT[variant][String(P)];
  return tubFrame(variant, active, bodyFn(L))[0];
}

/* Home Lab. */
const TU_HEALTH_ORDER = { down: 0, crit: 1, warn: 2, unknown: 3, ok: 4 };
function tubHomelab(c) {
  return tubScreen('lab', 'lab', function (L) {
    const A = kioskLab();
    let h = '';
    if (A.mode === 'unconfigured') {
      const fl = tubSlot(L, 'faultlist');
      return tubAnn(fl.x + 186, fl.y + fl.h / 2 - 36, 600, 72, 'white', `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:${kq(22)};letter-spacing:.1em">` +
        tubPaint('HOME LAB NOT CONFIGURED', 22, TU.ink, 'text-shadow:none') + `</div>`);
    }
    const pending = A.mode === 'pending';
    const on = pending ? -1 : A.stale ? 1 : A.mode === 'crit' ? 2 : A.mode === 'warn' ? 1 : 0;
    const dim = A.stale ? 'opacity:.55;' : '';
    // The condition: three lamps, the lit one's name marked.
    ['green', 'amber', 'red'].forEach(function (col, i) {
      const s = L.slots.filter(function (x) { return x.kind === 'cond'; })[i];
      h += tubJewel(s.x, s.y, s.d, col, i === on);
    });
    h += `<div data-cond style="position:absolute;left:0;top:0">` + ['NORMAL', 'CAUTION', 'ALERT'].map(function (n, i) {
      const l = tubLabel(L, 'cond', i);
      return `<span style="position:absolute;left:${kq(l.x)};top:${kq(l.y)};width:${kq(l.w)};height:${kq(l.h)};display:flex;align-items:center;justify-content:center">` +
        tubPaint(n, 11, i === on ? TU.paint : TU.dim, '', i !== on) + `</span>`;
    }).join('') + `</div>`;
    const hs = tubSlot(L, 'hosts'), fs = tubSlot(L, 'faults');
    const nh = A.hosts.length, ni = A.issues.length;
    h += nh > 9 ? tubNixieRow(hs.x, hs.y + 6, 40, String(nh).slice(-2), 'l') : tubNixieRow(hs.x, hs.y, hs.h, pending && !nh ? ' ' : String(nh), 'l');
    h += tubNixieRow(fs.x, fs.y, fs.h, pending ? '  ' : String(Math.min(ni, 99)).padStart(2, '0'), 'l');
    // Stations: nine slots; past nine, the eight worst and a plate for the rest.
    let shown = A.hosts, extra = [];
    if (nh > 9) {
      const ranked = A.hosts.map(function (x, i) { return [x, i]; }).sort(function (a, b) {
        return (TU_HEALTH_ORDER[a[0].health] - TU_HEALTH_ORDER[b[0].health]) || (a[1] - b[1]);
      });
      const keep = new Set(ranked.slice(0, 8).map(function (r) { return r[1]; }));
      shown = A.hosts.filter(function (_, i) { return keep.has(i); });
      extra = A.hosts.filter(function (_, i) { return !keep.has(i); });
    }
    const hcol = function (x) { return x.health === 'ok' ? TU.paint : x.health === 'warn' ? TU.warm : x.health === 'unknown' ? TU.dim : TU.hot; };
    shown.forEach(function (x, k) {
      const up = tubSlot(L, 'hostup', k), he = tubSlot(L, 'hosthealth', k), lb = tubLabel(L, 'host', k);
      h += `<div style="${dim}">` + tubJewel(up.x, up.y, up.d, x.up === false ? 'red' : 'blue', x.up !== null) +
        tubJewel(he.x, he.y, he.d, x.health === 'warn' ? 'amber' : x.health === 'ok' ? 'green' : 'red', x.health !== 'unknown') + `</div>`;
      h += tubPlate(lb, x.name.toUpperCase(), hcol(x), 15, ` data-host="${esc(x.name)}" data-up="${x.up}" data-health="${x.health}"`);
    });
    if (extra.length) {
      const worst = extra.slice().sort(function (a, b) { return TU_HEALTH_ORDER[a.health] - TU_HEALTH_ORDER[b.health]; })[0];
      h += tubPlate(tubLabel(L, 'host', 8), '+' + extra.length + ' HOSTS', hcol(worst), 15);
    }
    // The fault register.
    const fl = tubSlot(L, 'faultlist'), fc = tubSlot(L, 'faultcount');
    h += tAbs(fc.x - 300, fc.y - 12, 300, 24, tubPaint(pending ? 'ACQUIRING TELEMETRY' : ni + ' OPEN', 12, ni ? TU.warm : TU.paint), 'display:flex;justify-content:flex-end;align-items:center');
    if (A.stale) h += tAbs(170, fc.y - 12, 420, 24, tubPaint('STALE · CHECKED ' + (A.checkedAt ? sessAge(A.checkedAt) + ' AGO' : 'NEVER'), 12, TU.warm), 'display:flex;align-items:center');
    if (pending) return h;
    if (!ni) {
      return h + tubAnn(fl.x, fl.y + 6, fl.w - 252, 52, 'off', `<div style="height:100%;display:flex;align-items:center;padding:0 ${kq(14)};font-size:${kq(18)};letter-spacing:.08em">NO OPEN FAULTS</div>`);
    }
    const lay = kioskIssueLayout(ni, fl.h), col = function (i) { return i.severity === 'crit' ? 'red' : 'amber'; };
    let list = '';
    if (lay.big) {
      const rh = Math.min(58, lay.rowH);
      A.issues.forEach(function (i, k) {
        const y = fl.y + k * lay.rowH;
        list += tubAnn(fl.x, y, fl.w - 252, rh - 6, col(i), `<div style="height:100%;padding:0 ${kq(14)};display:flex;flex-direction:column;justify-content:center;line-height:1.12">` +
          `<span style="font-size:${kq(11)};letter-spacing:.16em;opacity:.8">${esc(String(i.host).toUpperCase())}</span>` +
          `<span style="font-size:${kq(21)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.title)}</span></div>`, 7, ` data-alert="${k}"`);
        list += tAbs(fl.x + fl.w - 240, y + (rh - 6) / 2 - 8, 50, 16, tubPaint('SINCE', 10, TU.dim, '', true));
        list += tubNixieRow(fl.x + fl.w, y + 2, rh - 10, hlClock(i.since), 'r');
      });
    } else {
      const cw = (fl.w - 14) / 2;
      A.issues.slice(0, lay.shown).forEach(function (i, k) {
        const cc = Math.floor(k / lay.rows), r = k % lay.rows;
        list += tubAnn(fl.x + cc * (cw + 14), fl.y + r * lay.rowH, cw, lay.rowH - 2, col(i),
          `<div style="height:100%;display:grid;grid-template-columns:${kq(118)} 1fr ${kq(46)};gap:0 ${kq(8)};align-items:center;padding:0 ${kq(8)}">` +
          `<span style="font-size:${kq(11)};letter-spacing:.06em;white-space:nowrap;overflow:hidden">${esc(String(i.host).toUpperCase())}</span>` +
          `<span style="font-size:${kq(14)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.title)}</span>` +
          `<span style="font-size:${kq(13)};text-align:right">${hlClock(i.since)}</span></div>`, 3, ` data-alert="${k}"`);
      });
      if (lay.more) list += tAbs(fl.x + cw + 14, fl.y + (lay.rows - 1) * lay.rowH, cw, lay.rowH, tubPaint('+' + lay.more + ' MORE', 12), 'display:flex;align-items:center');
    }
    return h + `<div style="${dim}">${list}</div>`;
  });
}

/* Sessions. */
const TU_SESS_WIN = { waiting: 'amber', busy: 'white', shell: 'green', idle: 'off' };
const TU_SESS_LAMP = { waiting: 'amber', busy: 'green', shell: 'green', idle: 'amber' };
const TU_SESS_WORD = { waiting: 'NEEDS INPUT', busy: 'WORKING', shell: 'RUNNING SHELL', idle: 'IDLE' };
function tubSessions(c) {
  return tubScreen('sessions', 'sessions', function (L) {
    const D = kioskSess(), off = D.status === 'offline';
    let h = '';
    const note = D.status === 'unconfigured' ? 'SESSION FEED NOT CONFIGURED' : D.status === 'pending' ? 'CONNECTING TO SESSION FEED'
      : !D.list.length ? (off ? 'SESSION FEED OFFLINE' : 'NO ACTIVE SESSIONS') : null;
    const shown = note ? [] : D.list.slice(0, 5), more = note ? 0 : D.list.length - shown.length;
    for (let k = 0; k < 5; k++) {
      const lp = tubSlot(L, 'slamp', k), sw = tubSlot(L, 'swin', k);
      const s = shown[k];
      if (!s) {
        h += tubJewel(lp.x, lp.y, lp.d, 'amber', false);
        h += tubAnn(sw.x, sw.y, sw.w, sw.h, note && k === 2 ? 'white' : 'off', note && k === 2
          ? `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:${kq(18)};letter-spacing:.1em">${tubPaint(note, 16, TU.ink, 'text-shadow:none')}</div>` : '');
        continue;
      }
      const st = TU_SESS_WIN[s.state] ? s.state : 'idle';
      const tk = tubSlot(L, 'stok', k), sa = tubSlot(L, 'sagents', k), sr = tubSlot(L, 'srun', k);
      const fade = off ? 'opacity:.5;' : '';
      h += `<div data-session="${k}" style="${fade}">` + tubJewel(lp.x, lp.y, lp.d, TU_SESS_LAMP[st], st !== 'idle') +
        tubAnn(sw.x, sw.y, sw.w, sw.h, TU_SESS_WIN[st], `<div style="height:100%;padding:0 ${kq(14)};display:flex;flex-direction:column;justify-content:center;line-height:1.15">` +
          `<span style="font-size:${kq(24)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</span>` +
          `<div data-state style="font-size:${kq(11)};letter-spacing:.12em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85">` +
          `${esc(String(s.project || '').toUpperCase())} · <span data-lit>${TU_SESS_WORD[st]}</span>${st === 'waiting' && s.message ? ' · ' + esc(s.message) : ''}</div></div>`);
      const tok = kioskTok(s.tokens), unit = (/[KMB]$/.exec(tok) || [''])[0], num = tok === '--' ? '  ' : tok.replace(/[KMB]$/, '');
      h += tubNixieRow(tk.x - 20, tk.y, tk.h, num, 'r') + tAbs(tk.x - 16, tk.y + tk.h - 22, 18, 18, tubPaint(unit, 13));
      h += tubNixieRow(sa.x, sa.y, sa.h, s.agents ? String(s.agents) : ' ', 'c');
      const age = sessAge(s.since).split(' ')[0], u = /d/i.test(age) ? 'DAY' : /h/i.test(age) ? 'HR' : /m/i.test(age) ? 'MIN' : 'SEC';
      h += tubNixieRow(sr.x - 36, sr.y, sr.h, age.replace(/[^0-9]/g, ''), 'r') + tAbs(sr.x - 32, sr.y + sr.h - 22, 34, 18, tubPaint(u, 12)) + `</div>`;
    }
    const f = tubSlot(L, 'sfoot');
    const left = off ? tubPaint('SESSION FEED OFFLINE · LAST UPDATE ' + (D.checkedAt ? hlClock(D.checkedAt) : 'NEVER'), 12, TU.warm)
      : D.status === 'ok' ? tubPaint('FEED LIVE' + (D.host ? ' · ' + esc(D.host.toUpperCase()) : ''), 12) : '<span></span>';
    const right = D.status === 'ok' || off
      ? tubPaint((more ? '+' + more + ' MORE · ' : '') + D.list.length + ' ACTIVE · ' + D.waiting + ' NEEDS INPUT', 12, D.waiting ? TU.warm : TU.paint) : '';
    return h + tAbs(f.x, f.y, f.w, f.h, left + right, 'display:flex;justify-content:space-between;align-items:center');
  });
}

/* GPUs. */
function tubGpus(c) {
  const G = kioskGpus(), n = G.rows.length, variant = n > 4 ? 'gpus8' : 'gpus4', big = variant === 'gpus4';
  return tubScreen(variant, 'gpus', function (L) {
    const empty = gpuEmptyNote(G);
    const f = tubSlot(L, 'gfoot');
    const stale = G.stale ? tubPaint('TELEMETRY STALE · LAST UPDATE ' + G.checked + ' · ', 12, TU.warm) : '';
    if (empty) {
      return tubAnn(212, L.labels[0].y + 160, 600, 72, empty[1] === bsS().warn ? 'amber' : 'white',
        `<div style="height:100%;display:flex;align-items:center;justify-content:center;padding:0 ${kq(12)}">${tubPaint(empty[0], 14, TU.ink, 'text-shadow:none;white-space:normal;text-align:center')}</div>`) +
        (stale ? tAbs(f.x, f.y, f.w, f.h, stale, 'display:flex;align-items:center') : '');
    }
    const stc = function (g) { return g.state === 'critical' ? 'red' : g.state === 'throttling' || g.state === 'hot' || g.state === 'offline' || g.state === 'unreadable' ? 'amber' : g.state === 'busy' ? 'green' : 'blue'; };
    const tcol = function (t) { return t >= 85 ? TU.hot : t >= 75 ? TU.warm : TU.paint; };
    let h = '';
    G.rows.slice(0, 8).forEach(function (g, k) {
      const lb = tubLabel(L, 'gpu', k), ey = tubSlot(L, 'geye', k), tp = tubSlot(L, 'gtemp', k), vr = tubSlot(L, 'gvram', k),
        pw = tubSlot(L, 'gpow', k), st = tubSlot(L, 'gstate', k);
      const util = gpuFin(g.util), temp = gpuFin(g.temp), pwr = gpuFin(g.power), lim = gpuFin(g.power_limit), mt = gpuFin(g.mem_temp);
      const used = gpuFin(g.vram_used), tot = gpuFin(g.vram_total);
      const vpct = used !== null && tot !== null && tot > 0 ? Math.max(0, Math.min(100, used / tot * 100)) : null;
      let b = tubPlate(lb, g.host.toUpperCase() + ' · GPU ' + g.index, TU.paint, big ? 15 : 13);
      b += tAbs(lb.x, lb.y + lb.h + 3, lb.w, 14, g.fresh ? tubPaint(esc(g.short), big ? 10 : 9, TU.dim)
        : tubPaint('SEEN ' + (g.seen_at ? sessAge(g.seen_at) : '--') + ' AGO', big ? 10 : 9, TU.warm), 'display:flex;justify-content:center;overflow:hidden');
      b += tubEye(ey.x, ey.y, ey.d, util, 'tu-' + k);
      b += tubNixieRow(tp.x - (big ? 6 : 0), tp.y, tp.h, temp === null ? '  ' : String(Math.round(temp)), 'c') +
        tAbs(tp.x + tp.h * 0.78, tp.y + tp.h - 22, 30, 18, tubPaint('&deg;C', big ? 13 : 11));
      if (mt !== null && mt >= -50 && mt <= 200) {
        b += tAbs(tp.x - 60, tp.y + tp.h + (big ? 2 : 1), 120, 14, tubPaint('MEM ' + Math.round(mt) + '&deg;', big ? 11 : 9, tcol(mt)), 'display:flex;justify-content:center', ' data-mem');
      }
      if (big) {
        b += tAbs(ey.x - 60, ey.y + ey.d / 2 + 14, 120, 14, tubPaint('LOAD', 10, TU.dim, '', true), 'display:flex;justify-content:center') +
          tAbs(tp.x - 60, tp.y - 12, 120, 14, tubPaint('CORE TEMP', 10, TU.dim, '', true), 'display:flex;justify-content:center');
      }
      const vv = vpct === null ? '--' : (used / 1024).toFixed(1) + '/' + Math.round(tot / 1024) + 'G';
      const pv = (pwr === null ? '--' : Math.round(pwr)) + '/' + (lim === null ? '--' : Math.round(lim)) + 'W';
      const rowc = 'display:flex;justify-content:space-between;align-items:flex-end;line-height:1';
      b += tAbs(vr.x + 8, vr.y - (big ? 16 : 13), vr.w - 16, big ? 14 : 12, tubPaint('VRAM', big ? 10 : 9, TU.dim, '', true) + tubPaint(vv, big ? 11 : 10), rowc);
      b += tAbs(pw.x + 8, pw.y - (big ? 16 : 13), pw.w - 16, big ? 14 : 12, tubPaint(big ? 'POWER' : 'PWR', big ? 10 : 9, TU.dim, '', true) + tubPaint(pv, big ? 11 : 10), rowc);
      b += tubIn13(vr.x, vr.y, vr.w, vpct, 'blue', 'v' + k) +
        tubIn13(pw.x, pw.y, pw.w, pwr !== null && lim ? Math.max(0, Math.min(100, pwr / lim * 100)) : null, g.state === 'idle' ? 'green' : 'orange', 'p' + k);
      const d = big ? 22 : 16, sc = stc(g);
      b += tubJewel(st.x + d / 2, st.y, d, sc, true) +
        tAbs(st.x + d + 8, st.y - 9, 140, 18, `<div data-state>` + tubPaint(GPU_LABEL[g.state] || 'UNKNOWN', big ? 13 : 11, sc === 'red' ? TU.hot : sc === 'amber' ? TU.warm : TU.paint) + `</div>`, 'display:flex;align-items:center');
      b += tAbs(st.x, st.y - 9, big ? 204 : 212, 18, tubPaint('PROC ' + (gpuFin(g.procs) === null ? '--' : gpuFin(g.procs)), big ? 12 : 10), 'display:flex;justify-content:flex-end;align-items:center');
      h += `<div data-gpu-row="${esc(g.host)}|${g.index}" style="position:absolute;inset:0;${g.fresh ? '' : 'opacity:.6'}">${b}</div>`;
    });
    const foot = stale + tubPaint(gpuFooterText(G), 12);
    const len = Array.from((stale + gpuFooterText(G)).replace(/<[^>]*>/g, '').replace(/&[a-z]+;|&#\d+;/g, 'x')).length;
    const fz = Math.max(0.6, Math.min(1, 1000 / (len * 0.74 * 12)));
    h += tAbs(f.x, f.y, f.w, f.h, `<span style="display:inline-flex;align-items:center;zoom:${fz.toFixed(3)}">${foot}</span>` +
      (n > 8 ? tubPaint('+' + (n - 8) + ' MORE', 12) : ''), 'display:flex;justify-content:space-between;align-items:center;white-space:nowrap;overflow:hidden');
    return h;
  });
}

function tubNotice(c) {
  return tubScreen('notice', '', function (L) {
    const w = tubSlot(L, 'nwin'), hint = tubSlot(L, 'nhint');
    return tubAnn(w.x, w.y, w.w, w.h, 'white', `<div style="height:100%;display:flex;align-items:center;justify-content:center">${tubPaint('NO SCREENS TO SHOW', 24, TU.ink, 'text-shadow:none')}</div>`) +
      tAbs(hint.x, hint.y, hint.w, hint.h, tubPaint('CHOOSE SCREENS IN THE CONTROL PANEL', 12, TU.paint), 'display:flex;justify-content:center;align-items:center');
  });
}

const RETRO_RENDERERS = {
  'Vintage/Scanlines': { lab: scanHomelab, sessions: scanSessions, gpus: scanGpus, notice: scanNotice, fluid: 'landscape' },
  'Vintage/VFD': { lab: vfdHomelab, sessions: vfdSessions, gpus: vfdGpus, notice: vfdNotice, fluid: 'landscape' },
  'Vintage/Tubes': { lab: tubHomelab, sessions: tubSessions, gpus: tubGpus, notice: tubNotice, fluid: 'landscape' },
};
Object.assign(KIOSK_RENDERERS, RETRO_RENDERERS);
