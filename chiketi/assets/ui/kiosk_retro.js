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

const RETRO_RENDERERS = {
  'Vintage/Scanlines': { lab: scanHomelab, sessions: scanSessions, gpus: scanGpus, notice: scanNotice, fluid: 'landscape' },
};
Object.assign(KIOSK_RENDERERS, RETRO_RENDERERS);
