/* ── kiosk_terminal.js: the Kiosk screens on the Terminal boards ──────────
 * The classic recolours (tmux) and the distro boards (btop). Ports of the
 * agreed v4 mockups. Shared pieces are in kiosk_looks.js. */

/* ── Terminal classic: tmux ───────────────────────────────────────────────
 * tmux with its status line on top: windows `k:id` by plan position, the
 * current one filled, `#` after a window that needs attention, then day, date
 * and time. Base text 19 units; panels sized to their content. Each recolour
 * uses its own palette (the `c` it is given) plus a few tones matched to it;
 * layout and type are identical across the six. Reference: v4 prototype
 * tclFrame / tclPanel / tclLabV2 / tclSessionsV2 / tclGpusV2. */
const TCL_TONES = {
  cyan:      { bar: '#00384a', ink: '#001018', bright: '#e6faff', soft: '#cfefff', soft2: '#9fe9ff', bad: '#ff5555' },
  amber:     { bar: '#3a2600', ink: '#140c00', bright: '#fff3dc', soft: '#ffe0a6', soft2: '#ffd27a', bad: '#ff5555' },
  phosphor:  { bar: '#003a08', ink: '#001200', bright: '#e8ffe8', soft: '#c6ffc6', soft2: '#99ff99', bad: '#ff5555' },
  red_alert: { bar: '#400808', ink: '#180000', bright: '#ffe9e9', soft: '#ffcaca', soft2: '#ff9d9d', bad: '#ffffff' },
  blue:      { bar: '#0d2250', ink: '#000a20', bright: '#e8f0ff', soft: '#cfe0ff', soft2: '#9fc2ff', bad: '#ff5555' },
  hacker:    { bar: '#003a10', ink: '#001806', bright: '#e6ffec', soft: '#c6ffd2', soft2: '#8dffa9', bad: '#ff5555' },
};
const TERM_FONT = "'IBM Plex Mono', monospace";
function tw(c, t) { return `<span style="color:${c}">${t}</span>`; }
/* "6s ago", "5m ago", "2h ago". */
function tAgo(epoch) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - epoch));
  return s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + 'm ago' : Math.floor(s / 3600) + 'h ago';
}
/* A block bar: k of n cells filled. */
function tBlocks(frac, n, on, off) {
  const k = frac === null ? 0 : Math.max(0, Math.min(n, Math.round(frac * n)));
  return tw(on, '█'.repeat(k) + '░'.repeat(n - k)) + (off ? '' : '');
}

function tclFrame(v, C, active, panels) {
  const T = TCL_TONES[v];
  const D = kioskClock();
  const worst = kioskWorst();
  const win = kioskMenu(active).map(function (t, k) {
    if (t.active) return `<span${kioskTabAttrs(t)} style="background:${C.primary};color:${T.ink};font-weight:700;padding:0 ${kq(7)}">${k}:${t.key}*</span>`;
    const col = !t.live ? C.dim : t.att === 'crit' ? T.bad : t.att === 'warn' ? C.accent : T.soft2;
    return `<span${kioskTabAttrs(t)} style="padding:0 ${kq(7)};color:${col}">${k}:${t.key}${t.att ? '#' : ''}</span>`;
  }).join('');
  return bsFrame(`<div data-status="${worst}" style="position:absolute;inset:0;background:${C.background};font-family:${TERM_FONT};color:${C.primary};` +
      `font-size:${kq(19)};line-height:${kq(25)}">` +
    `<div style="position:absolute;left:0;right:0;top:0;height:${kq(34)};background:${T.bar};display:flex;align-items:center;white-space:pre;font-size:${kq(19)}">` +
      `<span style="padding:0 ${kq(8)};color:${C.primary};font-weight:700">[kiosk]</span>${win}` +
      `<span style="margin-left:auto;padding:0 ${kq(12)};color:${T.soft}">${D.short} ${D.hm}</span></div>` +
    panels + `</div>`, 'landscape', 'Terminal/' + v);
}
function tclPanel(C, x, y, w, h, title, right, lines) {
  return `<div style="position:absolute;left:${kq(x)};top:${kq(y)};width:${kq(w)};height:${kq(h)};box-sizing:border-box;background:${C.panel};` +
      `border:1px solid ${C.border};padding:${kq(6)} ${kq(12)};white-space:pre;overflow:hidden">` +
    `<div style="display:flex;gap:${kq(8)};color:${C.primary};white-space:nowrap"><span>──[ ${title} ]</span>` +
      `<span style="flex:1;overflow:hidden;color:${C.border}">${'─'.repeat(120)}</span>${right ? `<span>${right}</span>` : ''}</div>${lines}</div>`;
}

function tclHomelab(v, C) {
  kioskSkin('tcl-' + v, C.background, TERM_FONT);
  const T = TCL_TONES[v];
  const L = kioskLab();
  const H = kioskH();
  const WH = T.bright;
  const hs = L.hosts.map(function (h) {
    const up = h.up === true ? tw(C.primary, '▲') : h.up === false ? tw(T.bad, '▼') : tw(C.dim, '?');
    const hl = { ok: tw(C.dim, 'ok   '), warn: tw(C.accent, 'warn '), crit: tw(T.bad, 'ALERT'), down: tw(T.bad, 'DOWN '),
                 unknown: tw(C.dim, '--   ') }[h.health];
    const cnt = h.n && h.health !== 'down' ? tw(h.health === 'crit' ? T.bad : C.accent, ' ' + h.n) : '  ';
    return `<span data-host="${esc(h.name)}" data-up="${h.up}" data-health="${h.health}"${L.stale ? ' style="opacity:.45"' : ''}>` +
      `${up} ${tw(WH, kpad(h.name, 14))} ${hl}${cnt}</span>`;
  });
  const hRows = Math.max(1, Math.ceil(hs.length / 3));
  const grid = Array.from({ length: hRows }, function (_, r) {
    return [0, 1, 2].map(function (c) { return hs[c * hRows + r] || ''; }).join('   ');
  }).join('\n');
  const hostsH = 37 + hRows * 25;
  const issTop = 112 + hostsH + 6;
  const issH = H - issTop - 8;
  const n = L.issues.length;
  const roomy = n <= 6 && 37 + 34 * (n + 1) <= issH;
  const lh = roomy ? 34 : 25;
  const cap = Math.max(1, Math.floor((issH - 12 - 25) / lh) - 1);
  const f = kioskFit(n, cap, cap - 1);
  const C2 = C;
  const iss = L.mode === 'pending' ? tw(C.dim, 'acquiring telemetry')
    : n === 0 ? tw(C.dim, 'no open issues')
    : tw(C.dim, 'SEV   HOST            ISSUE                                SINCE') + '\n' +
      L.issues.slice(0, f.shown).map(function (i, k) {
        return `<span data-alert="${k}">${i.severity === 'crit' ? tw(T.bad, 'CRIT') : tw(C2.accent, 'WARN')}  ${tw(WH, kpad(i.host, 15))} ` +
          `${kpad(i.title, 36)} ${hlClock(i.since)}</span>`;
      }).join('\n') + (f.more ? '\n' + tw(C.dim, `+${f.more} more`) : '');
  const cond = { crit: tw(T.bad, 'RED'), warn: tw(C.accent, 'YELLOW'), nominal: tw(C.primary, 'GREEN'), stale: tw(C.accent, 'STALE'),
                 pending: tw(C.dim, 'PENDING') }[L.mode] || tw(C.dim, 'PENDING');
  const K = L.counts;
  const right = L.stale ? tw(C.accent, `telemetry stale · checked ${tAgo(L.checkedAt)}`) : L.checkedAt !== null ? `checked ${tAgo(L.checkedAt)}` : '';
  if (L.mode === 'unconfigured') {
    return tclFrame(v, C, 'lab', tclPanel(C, 8, 42, 1008, H - 50, 'HOME LAB', '', tw(C.dim, 'home lab not configured')));
  }
  return tclFrame(v, C, 'lab',
    tclPanel(C, 8, 42, 1008, 64, 'STATUS', right,
      `condition ${cond}   hosts ${L.hosts.length}   healthy ${tw(C.primary, K.ok)}   warn ${tw(C.accent, K.warn)}   ` +
      `alert ${tw(K.crit + K.down ? T.bad : C.dim, K.crit + K.down)}`) +
    tclPanel(C, 8, 112, 1008, hostsH, 'HOSTS', 'up · health', grid) +
    tclPanel(C, 8, issTop, 1008, issH, 'ISSUES', `${n} open`,
      roomy ? `<div style="font-size:${kq(23)};line-height:${kq(34)}">${iss}</div>` : iss));
}

function tclSessions(v, C) {
  kioskSkin('tcl-' + v, C.background, TERM_FONT);
  const T = TCL_TONES[v];
  const D = kioskSess();
  const H = kioskH();
  const WH = T.bright;
  const sc = { waiting: C.accent, busy: C.primary, shell: T.soft, idle: C.dim };
  const panelH = 330 + (H - 600);
  const lines = Math.floor((panelH - 12 - 25) / 25) - 1;   // under the heading line
  const need = function (k) { return D.list.slice(0, k).reduce(function (a, s) { return a + (s.message ? 2 : 1); }, 0); };
  const capFor = function (room) { let k = 0; while (k < D.list.length && need(k + 1) <= room) k++; return k; };
  let f = kioskFit(D.list.length, capFor(lines), capFor(lines - 1));
  // Too many messages to show five: one line per session, and the messages
  // under the first ones while they fit.
  let msgRoom = Infinity;
  if (f.shown < Math.min(5, D.list.length)) {
    f = kioskFit(D.list.length, lines, lines - 1);
    msgRoom = (f.more ? lines - 1 : lines) - f.shown;
  }
  const off = D.status === 'offline';
  let body;
  if (D.status === 'unconfigured') body = tw(C.dim, 'session feed not configured');
  else if (D.status === 'pending') body = tw(C.dim, 'connecting to session feed');
  else if (!D.list.length) body = off ? tw(C.accent, 'session feed offline') : tw(C.dim, 'no active sessions');
  else {
    body = tw(C.dim, '  SESSION              PROJECT     STATE           TOKENS  AGT     AGE') + '\n' +
      `<span${off ? ' style="opacity:.45"' : ''}>` +
      D.list.slice(0, f.shown).map(function (s, k) {
        const st = SESS_ORDER[s.state] !== undefined ? s.state : 'idle';
        return `<span data-session="${k}">${st === 'waiting' ? tw(C.accent, '▶') : ' '} ${tw(st === 'waiting' ? C.accent : WH, kpad(s.name, 20))} ` +
          `${kpad(s.project, 11)} ${tw(sc[st], kpad(SESS_LABEL[st].toLowerCase(), 13))} ${klpad(kioskTok(s.tokens), 8)}  ` +
          `${klpad(s.agents || '-', 3)} ${klpad(sessAge(s.since), 7)}</span>` +
          (s.message && msgRoom-- > 0 ? '\n  ' + tw(C.accent, '└ ' + esc(s.message)) : '');
      }).join('\n') + `</span>` + (f.more ? '\n' + tw(C.dim, `+${f.more} more`) : '');
  }
  // The feed and the tokens, from the data (the mockup's numbers were made up).
  const ck = m('sessions.checked_at');
  const poll = Number(ck.extra && ck.extra.poll_seconds) || 2;
  const tools = Array.from(new Set(D.list.map(function (s) { return s.tool === 'codex' ? 'codex' : 'claude-code'; }))).join(', ') || '--';
  const feed = `source   ${esc(D.host || '--')}\nclients  ${esc(tools)}\n` +
    `updated  ${D.checkedAt ? tw(off ? T.bad : C.primary, tAgo(D.checkedAt)) : tw(C.dim, 'never')}\n` +
    `polling  every ${poll}s` + (off ? '\n' + tw(T.bad, 'session feed offline') : '');
  const sum = { working: 0, waiting: 0, idle: 0 };
  let total = 0;
  D.list.forEach(function (s) {
    const t = typeof s.tokens === 'number' && isFinite(s.tokens) ? s.tokens : 0;
    total += t;
    sum[s.state === 'waiting' ? 'waiting' : s.state === 'idle' ? 'idle' : 'working'] += t;
  });
  const tb = function (x) { return x > 0 ? Math.max(1, Math.round(x / Math.max(1, total) * 18)) : 0; };
  const bar = function (x, col) { const k = tb(x); return tw(col, '█'.repeat(k) + '░'.repeat(18 - k)); };
  const tok = `total     ${fmtTok(total)}\nworking   ${klpad(fmtTok(sum.working), 6)} ${bar(sum.working, C.primary)}\n` +
    `waiting   ${klpad(fmtTok(sum.waiting), 6)} ${bar(sum.waiting, C.accent)}\nidle      ${klpad(fmtTok(sum.idle), 6)} ${bar(sum.idle, C.dim)}`;
  const y2 = 42 + panelH + 6, h2 = H - y2 - 8;
  return tclFrame(v, C, 'sessions',
    tclPanel(C, 8, 42, 1008, panelH, 'SESSIONS', `${D.list.length} active · ${D.waiting} needs input`, body) +
    tclPanel(C, 8, y2, 498, h2, 'FEED', off ? tw(T.bad, 'offline') : D.status === 'ok' ? 'live' : D.status === 'pending' ? 'connecting' : '', feed) +
    tclPanel(C, 518, y2, 498, h2, 'TOKENS', '', tok));
}

function tclGpus(v, C) {
  kioskSkin('tcl-' + v, C.background, TERM_FONT);
  const T = TCL_TONES[v];
  const G = kioskGpus();
  const H = kioskH();
  const WH = T.bright;
  const n = G.rows.length;
  const empty = gpuEmptyNote(G);
  const sc = function (s) {
    return s === 'throttling' || s === 'hot' || s === 'unreadable' || s === 'offline' ? C.accent : s === 'critical' ? T.bad : s === 'busy' ? C.primary : C.dim;
  };
  const word = function (s) { return GPU_LABEL[s].toLowerCase(); };
  const right = function () { return `${n} cards · ${G.busy + G.hot} busy · ${esc(G.powerText.replace(/ NOW$/, ' now').replace(/ FROM (\d+) OF (\d+) GPUS$/, ' from $1 of $2 gpus'))}`; };
  if (empty) {
    return tclFrame(v, C, 'gpus', tclPanel(C, 8, 42, 1008, H - 50, 'GPUS', G.stale ? tw(C.accent, 'telemetry stale') : '',
      (G.stale ? tw(C.accent, `telemetry stale · last update ${G.checked.toLowerCase()}`) + '\n' : '') + tw(empty[1] === bsS().warn ? C.accent : C.dim, empty[0].toLowerCase())));
  }
  // The table keeps at least three lines for the LOAD panel under it.
  const rowsCap = Math.max(1, Math.floor((H - 56 - 112 - 40) / 25) - 4);
  const ft = kioskFit(n, rowsCap, rowsCap - 1);
  const Lrule = '+' + '-'.repeat(78) + '+';
  const rows = G.rows.slice(0, ft.shown).map(function (g) {
    const vu = gpuFin(g.vram_used), vt = gpuFin(g.vram_total);
    const vram = vu !== null && vt ? (vu / 1024).toFixed(1) + '/' + Math.round(vt / 1024) + 'G' : '--';
    const mt = gpuFin(g.mem_temp);
    const mem = mt !== null && mt >= -50 && mt <= 200 ? `<span data-mem style="color:${mt >= 85 ? C.accent : C.primary}">${klpad(Math.round(mt) + 'C', 4)}</span>` : '   -';
    const pw = gpuFin(g.power), pl = gpuFin(g.power_limit);
    return `<span data-gpu-row="${esc(g.host)}|${g.index}"${g.fresh ? '' : ' style="opacity:.6"'}>| ${tw(WH, kpad(g.host, 9))} ${klpad(g.index, 2)} ` +
      `${kpad(g.short, 11)} ${tw(sc(g.state), kpad(word(g.state), 10))}| ${klpad(vram, 10)} | ${klpad(kNum(g.util) === '--' ? '--' : kNum(g.util) + '%', 4)} ` +
      `${klpad(kNum(g.temp) === '--' ? '--' : kNum(g.temp) + 'C', 4)} ${mem} ${klpad((pw === null ? '--' : Math.round(pw)) + '/' + (pl === null ? '--' : Math.round(pl)) + 'W', 9)} |</span>`;
  }).join('\n');
  const head = `| ${tw(C.dim, 'HOST      GPU NAME        STATE     | MEM-USAGE  | UTIL TEMP  MEM PWR:USE/CAP')} |\n|${'='.repeat(78)}|`;
  const th = 25 * (ft.shown + 4 + (ft.more ? 1 : 0)) + 40;
  const loadH = H - 56 - th;
  const roomy = n <= 4;
  const lh = roomy ? 44 : 25;
  const lcap = Math.max(1, Math.floor((loadH - 12 - 25) / lh));
  const fl = kioskFit(n, lcap, lcap - 1);
  const bars = G.rows.slice(0, fl.shown).map(function (g) {
    const u = gpuFin(g.util), vv = gpuVram(g);
    const seen = g.fresh ? '' : '  ' + tw(C.dim, 'seen ' + (g.seen_at ? sessAge(g.seen_at) : '--') + ' ago');
    return `${kpad(g.host + ':' + g.index, 11)} ${tBlocks(u === null ? null : u / 100, 22, sc(g.state))} ${klpad(u === null ? '--' : Math.round(u), 3)}%  ` +
      `vram ${tBlocks(vv.pct === null ? null : vv.pct / 100, 16, C.primary)}${seen}`;
  }).join('\n') + (fl.more ? '\n' + tw(C.dim, `and ${fl.more} below (all in the table)`) : '');
  const stale = G.stale ? tw(C.accent, `telemetry stale · last update ${G.checked.toLowerCase()}`) + '  ' : '';
  const nr = G.incomplete.length ? tw(C.accent, ' · not reached: ' + gpuHostList(G.incomplete)) : '';
  return tclFrame(v, C, 'gpus',
    tclPanel(C, 8, 42, 1008, th, 'GPUS', stale + right() + nr,
      `${Lrule}\n${head}\n${rows}\n${Lrule}` + (ft.more ? '\n' + tw(C.dim, `+${ft.more} more`) : '')) +
    tclPanel(C, 8, 48 + th, 1008, H - 56 - th, 'LOAD', 'util · vram',
      roomy ? `<div style="font-size:${kq(23)};line-height:${kq(44)}">${bars}</div>` : bars));
}

function tclNotice(v, C) {
  kioskSkin('tcl-' + v, C.background, TERM_FONT);
  return tclFrame(v, C, '', tclPanel(C, 8, 42, 1008, kioskH() - 50, 'KIOSK', '', 'NO SCREENS TO SHOW · CHOOSE THEM IN THE CONTROL PANEL'));
}

/* One named renderer per recolour (the harness and the site key on names). */
function kioskNamed(name, fn) { Object.defineProperty(fn, 'name', { value: name }); return fn; }
const TCL_RENDERERS = {};
['cyan', 'amber', 'phosphor', 'red_alert', 'blue', 'hacker'].forEach(function (v) {
  const N = 'tcl' + v.split('_').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join('');
  TCL_RENDERERS['Terminal/' + v] = {
    lab: kioskNamed(N + 'Homelab', function (c) { return tclHomelab(v, c); }),
    sessions: kioskNamed(N + 'Sessions', function (c) { return tclSessions(v, c); }),
    gpus: kioskNamed(N + 'Gpus', function (c) { return tclGpus(v, c); }),
    notice: kioskNamed(N + 'Notice', function (c) { return tclNotice(v, c); }),
    fluid: 'landscape',
  };
});

/* ── Terminal distro: btop ────────────────────────────────────────────────
 * btop-style numbered tabs (¹ lab ² sessions ³ gpus …, by plan position), the
 * current one filled and amber marking attention; a pixel clock; IBM Plex Mono
 * at 19–21 units in each board's DISTRO_SKINS colours. Home Lab is a host
 * summary: up, health, the host's worst issue and +n for the rest. Reference:
 * v4 prototype tdsFrame / pixClock / tgrad / tdsLabV2 / tdsSessionsV2 /
 * tdsGpusV2 (drawn there in Arch). */
const TDS_SUP = '¹²³⁴⁵⁶⁷⁸⁹';
const TDS_PIX = { '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
                  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001',
                  '8': '111101111101111', '9': '111101111001111' };
function pixClock(S, str) {
  return `<span style="display:inline-flex;gap:${kq(6)}">` + Array.from(str).map(function (ch) {
    return ch === ':'
      ? `<span style="display:inline-grid;grid-template-columns:${kq(10)};grid-auto-rows:${kq(10)};gap:${kq(2)}">` +
          [0, 1, 0, 1, 0].map(function (b) { return `<i style="background:${b ? S.accent : 'transparent'}"></i>`; }).join('') + `</span>`
      : `<span style="display:inline-grid;grid-template-columns:repeat(3,${kq(10)});grid-auto-rows:${kq(10)};gap:${kq(2)}">` +
          Array.from(TDS_PIX[ch] || '000000000000000').map(function (b) { return `<i style="background:${b === '1' ? S.accent : 'transparent'}"></i>`; }).join('') + `</span>`;
  }).join('') + `</span>`;
}
/* btop's gradient meter: accent, then meter, then red, over the board's dark cells. */
function tgrad(S, frac, n) {
  const k = frac === null ? 0 : Math.max(0, Math.min(n, Math.round(frac * n)));
  let out = '';
  for (let i = 0; i < n; i++) out += `<span style="color:${i < k ? (i / n < 0.5 ? S.accent : i / n < 0.8 ? S.meter : S.crit) : S.off}">■</span>`;
  return out;
}
function tdsFrame(S, v, active, body) {
  const D = kioskClock();
  const worst = kioskWorst();
  const host = m('sys.hostname');
  const tabs = kioskMenu(active).map(function (t, k) {
    const sup = TDS_SUP.charAt(k) || String(k + 1);
    if (t.active) {
      return `<span${kioskTabAttrs(t)} style="background:${S.accent};color:${S.bg};font-weight:700;padding:${kq(2)} ${kq(6)};border-radius:${kq(4)}">${sup} ${t.key}</span>`;
    }
    const col = !t.live ? S.ghostText : t.att === 'crit' ? S.crit : t.att === 'warn' ? S.warnA : S.value;
    const bd = !t.live ? S.ghost : t.att === 'crit' ? S.crit : t.att === 'warn' ? S.warnA : S.dim;
    return `<span${kioskTabAttrs(t)} style="padding:${kq(2)} ${kq(6)};border:1px solid ${bd};border-radius:${kq(4)};color:${col}">${sup} ${t.key}</span>`;
  }).join('');
  return bsFrame(`<div data-status="${worst}" style="position:absolute;inset:0;background:${S.bg};font-family:${TERM_FONT};color:${S.value};` +
      `font-size:${kq(19)};line-height:${kq(25)}">` +
    `<div style="position:absolute;left:${kq(14)};top:${kq(10)};display:flex;align-items:center;gap:${kq(16)}">${pixClock(S, D.hm)}` +
      `<div style="line-height:${kq(22)}"><div style="color:${S.label};font-size:${kq(17)}">${D.short} ${D.year}</div>` +
      `<div style="color:${S.accent};font-size:${kq(17)};white-space:nowrap">chiketi · ${host.available ? esc(host.value) : '--'}</div></div></div>` +
    `<div style="position:absolute;left:${kq(366)};right:${kq(8)};top:${kq(18)};display:flex;gap:${kq(4)};font-size:${kq(16)};line-height:${kq(24)};` +
      `white-space:nowrap;overflow:hidden">${tabs}</div>` +
    `<div style="position:absolute;left:${kq(8)};right:${kq(8)};top:${kq(80)};bottom:${kq(8)};border:1px solid ${S.dim};border-radius:${kq(8)};` +
      `padding:${kq(12)} ${kq(16)};overflow:hidden">${body}</div></div>`, 'landscape', 'Terminal/' + v);
}
/* The summary line: 19 units while it fits the board (84 columns), smaller when a
   busy day makes it longer, never clipped. */
function tdsLine(html) {
  const n = Array.from(html.replace(/<[^>]*>/g, '').replace(/&[a-z]+;|&#\d+;/g, 'x')).length;
  const px = n > 84 ? Math.floor(19 * 84 / n * 10) / 10 : 19;
  return `<div style="white-space:pre;font-size:${kq(px)};overflow:hidden">${html}</div>`;
}
function tdsSkin(v) {
  _distroName = v;
  const S = distroSkin();
  kioskSkin('tds-' + v, S.bg, TERM_FONT);
  return S;
}

function tdsHomelab(v) {
  const S = tdsSkin(v);
  const L = kioskLab();
  const H = kioskH();
  const n = L.issues.length;
  const W = S.warnA, B = S.crit, OK = S.ok;
  const big = n <= 6;
  const lh = big ? 29 : 25;
  // Every host up to what fits (at least 12 at 576), then "+n more hosts".
  const room = Math.floor((H - 80 - 8 - 26 - 25 - 12 - lh - (n && n <= 4 ? 12 + 25 * (n + 1) : 0)) / lh);
  const fh = kioskFit(L.hosts.length, room, room - 1);
  const health = function (h) {
    return { ok: tw(OK, 'healthy'), warn: tw(W, 'warn   '), crit: tw(B, 'alert  '), down: tw(B, 'down   '), unknown: tw(S.dim, '--     ') }[h.health];
  };
  const tbl = tw(S.accent, 'host            up    health   issues') + '\n' +
    L.hosts.slice(0, fh.shown).map(function (h) {
      const up = h.up === true ? tw(OK, 'up   ') : h.up === false ? tw(B, 'down ') : tw(S.dim, '?    ');
      const worst = h.issues[0];
      const iss = worst ? tw(worst.severity === 'crit' ? B : W, kpad(worst.title, 38)) + (h.issues.length > 1 ? tw(S.label, ` +${h.issues.length - 1}`) : '')
        : tw(S.dim, '-');
      return `<span data-host="${esc(h.name)}" data-up="${h.up}" data-health="${h.health}"${L.stale ? ' style="opacity:.45"' : ''}>` +
        `${kpad(h.name, 15)} ${up} ${health(h)}  ${iss}</span>`;
    }).join('\n') + (fh.more ? '\n' + tw(S.label, `+${fh.more} more hosts`) : '');
  const det = n && n <= 4 ? L.issues.map(function (i) {
    return `${tw(i.severity === 'crit' ? B : W, '▲')} ${kpad(i.host, 9)} ${esc(i.title)}  ${tw(S.label, hlClock(i.since))}`;
  }).join('\n') : '';
  const cond = { crit: tw(B, 'red'), warn: tw(W, 'yellow'), nominal: tw(OK, 'green'), stale: tw(W, 'stale'), pending: tw(S.dim, 'pending') }[L.mode] || tw(S.dim, 'pending');
  const K = L.counts;
  const bar = tw(S.dim, '│');
  const status = `condition ${cond}  ${bar} hosts ${tw(S.accent, L.hosts.length)}  healthy ${tw(OK, K.ok)}  warn ${tw(W, K.warn)}  ` +
    `alert ${tw(K.crit + K.down ? B : S.dim, K.crit + K.down)}  ${bar} ${n} issues  ${bar} ` +
    (L.checkedAt !== null ? (L.stale ? tw(W, 'stale · ' + tAgo(L.checkedAt)) : 'checked ' + tAgo(L.checkedAt)) : 'acquiring telemetry');
  if (L.mode === 'unconfigured') return tdsFrame(S, v, 'lab', tw(S.dim, 'home lab not configured'));
  return tdsFrame(S, v, 'lab', `<div style="font-size:${kq(big ? 21 : 19)};line-height:${kq(lh)}">` +
    tdsLine(status) +
    `<div style="white-space:pre;margin-top:${kq(12)}">${tbl}</div>` +
    (det ? `<div style="white-space:pre;margin-top:${kq(12)}">${tw(S.accent, 'detail')}\n${det}</div>` : '') + `</div>`);
}

function tdsSessions(v) {
  const S = tdsSkin(v);
  const D = kioskSess();
  const H = kioskH();
  const W = S.warnA;
  const sc = { waiting: W, busy: S.accent, shell: S.meter, idle: S.label };
  const max = Math.max.apply(null, [1].concat(D.list.map(function (s) { return typeof s.tokens === 'number' && isFinite(s.tokens) ? s.tokens : 0; })));
  const lines = Math.floor((H - 80 - 8 - 26 - 25 - 12) / 25) - 1;
  const need = function (k) { return D.list.slice(0, k).reduce(function (a, s) { return a + (s.message ? 2 : 1); }, 0); };
  const capFor = function (r) { let k = 0; while (k < D.list.length && need(k + 1) <= r) k++; return k; };
  let f = kioskFit(D.list.length, capFor(lines), capFor(lines - 1));
  let msgRoom = Infinity;
  if (f.shown < Math.min(5, D.list.length)) {
    f = kioskFit(D.list.length, lines, lines - 1);
    msgRoom = (f.more ? lines - 1 : lines) - f.shown;
  }
  const C = D.counts, bar = tw(S.dim, '│');
  const off = D.status === 'offline';
  const feed = off ? tw(S.crit, 'session feed offline · last update ' + (D.checkedAt ? hlClock(D.checkedAt) : 'never'))
    : D.status === 'ok' ? 'feed live' + (D.host ? ' · ' + esc(D.host) : '') : D.status === 'pending' ? 'connecting' : '';
  const status = `sessions ${tw(S.accent, D.list.length)}  ${bar} needs input ${tw(W, C.waiting)}  working ${tw(S.accent, C.busy)}  ` +
    `shell ${tw(S.meter, C.shell)}  idle ${tw(S.label, C.idle)}  ${bar} ${feed}`;
  let body;
  if (D.status === 'unconfigured') body = tw(S.dim, 'session feed not configured');
  else if (D.status === 'pending') body = tw(S.dim, 'connecting to session feed');
  else if (!D.list.length) body = off ? tw(S.crit, 'session feed offline') : tw(S.dim, 'no active sessions');
  else {
    body = tw(S.accent, 'session             project    state          tokens               agt  age') + '\n' +
      `<span${off ? ' style="opacity:.45"' : ''}>` +
      D.list.slice(0, f.shown).map(function (s, k) {
        const st = SESS_ORDER[s.state] !== undefined ? s.state : 'idle';
        const t = typeof s.tokens === 'number' && isFinite(s.tokens) ? s.tokens : null;
        return `<span data-session="${k}">${tw(st === 'waiting' ? W : S.value, kpad(s.name, 19))} ${kpad(s.project, 10)} ` +
          `${tw(sc[st], kpad(SESS_LABEL[st].toLowerCase(), 13))} ${klpad(kioskTok(s.tokens), 7)} ${tgrad(S, t === null ? null : t / max, 12)} ` +
          `${klpad(s.agents || '-', 3)} ${klpad(sessAge(s.since), 6)}</span>` +
          (s.message && msgRoom-- > 0 ? '\n' + tw(W, '└─ ' + esc(s.message)) : '');
      }).join('\n') + `</span>` + (f.more ? '\n' + tw(S.label, `+${f.more} more`) : '');
  }
  return tdsFrame(S, v, 'sessions', tdsLine(status) +
    `<div style="white-space:pre;margin-top:${kq(12)}">${body}</div>`);
}

function tdsGpus(v) {
  const S = tdsSkin(v);
  const G = kioskGpus();
  const H = kioskH();
  const W = S.warnA;
  const n = G.rows.length;
  const empty = gpuEmptyNote(G);
  const tight = n > 4;
  const lh = tight ? 21 : 25, per = tight ? 2 : 3;
  const room = Math.floor((H - 80 - 8 - 26 - 25 - 12) / lh);
  const f = kioskFit(n, Math.floor((room + (tight ? 0 : 1)) / per), Math.floor((room - 1 + (tight ? 0 : 1)) / per));
  const sc = function (st) {
    return st === 'throttling' || st === 'hot' || st === 'unreadable' || st === 'offline' ? W : st === 'critical' ? S.crit : st === 'busy' ? S.accent : S.label;
  };
  const low = function (t) { return esc(t).toLowerCase().replace(/ w /g, ' W ').replace(/ w$/, ' W'); };
  const bar = tw(S.dim, '│');
  const status = `gpus ${tw(S.accent, n)}  ${bar} busy ${tw(S.accent, G.busy)}  hot/throttling ${tw(W, G.hot)}  idle ${tw(S.label, G.idle)}  ${bar} ` +
    `${tw(S.accent, low(G.powerText))}  ${bar} checked ${G.checked.toLowerCase()}` +
    (G.stale ? '  ' + tw(W, 'telemetry stale') : '') + (G.incomplete.length ? '  ' + tw(W, 'not reached: ' + gpuHostList(G.incomplete)) : '');
  if (empty) {
    return tdsFrame(S, v, 'gpus', (G.stale ? `<div style="white-space:pre">${tw(W, 'telemetry stale · last update ' + G.checked.toLowerCase())}</div>` : '') +
      `<div style="white-space:pre;margin-top:${kq(12)}">${tw(empty[1] === bsS().warn ? W : S.label, empty[0].toLowerCase())}</div>`);
  }
  const blk = G.rows.slice(0, f.shown).map(function (g) {
    const mt = gpuFin(g.mem_temp);
    const mem = mt !== null && mt >= -50 && mt <= 200
      ? ' ' + `<span data-mem style="color:${mt >= 85 ? W : S.label}">mem ${Math.round(mt)}&deg;</span>` : '        ';
    const vu = gpuFin(g.vram_used), vt = gpuFin(g.vram_total), vv = gpuVram(g), u = gpuFin(g.util);
    const pw = gpuFin(g.power), pl = gpuFin(g.power_limit);
    const seen = g.fresh ? '' : '  ' + tw(S.dim, 'seen ' + (g.seen_at ? sessAge(g.seen_at) : '--') + ' ago');
    return `<span data-gpu-row="${esc(g.host)}|${g.index}"${g.fresh ? '' : ' style="opacity:.6"'}>${tw(S.meter, 'gpu' + g.index)} ` +
      `${tw(S.accent, kpad(g.host, 9))} ${kpad(g.short, 11)} ${tw(sc(g.state), kpad(GPU_LABEL[g.state].toLowerCase(), 10))} ` +
      `${tw(S.label, 'temp')} ${klpad(kNum(g.temp) === '--' ? '--' : kNum(g.temp) + '°', 4)}${mem} ${tw(S.label, 'pwr')} ` +
      `${klpad(pw === null ? '--' : Math.round(pw), 3)}/${pl === null ? '--' : Math.round(pl)}W ${tw(S.label, 'procs')} ${kNum(g.procs)}${seen}\n` +
      `     util ${tgrad(S, u === null ? null : u / 100, 24)} ${klpad(u === null ? '--' : Math.round(u), 3)}%   vram ${tgrad(S, vv.pct === null ? null : vv.pct / 100, 14)} ` +
      `${vu !== null && vt ? klpad((vu / 1024).toFixed(1), 4) + '/' + Math.round(vt / 1024) + 'G' : '--'}</span>`;
  }).join(tight ? '\n' : '\n\n') + (f.more ? '\n' + tw(S.label, `+${f.more} more`) : '');
  return tdsFrame(S, v, 'gpus', tdsLine(status) +
    `<div style="white-space:pre;margin-top:${kq(12)};${tight ? `font-size:${kq(17)};line-height:${kq(21)}` : ''}">${blk}</div>`);
}

function tdsNotice(v) {
  const S = tdsSkin(v);
  return tdsFrame(S, v, '', `<div style="white-space:pre">${tw(S.label, 'NO SCREENS TO SHOW · CHOOSE THEM IN THE CONTROL PANEL')}</div>`);
}

['Arch', 'Ubuntu', 'openSUSE', 'Mandriva'].forEach(function (v) {
  const N = 'tds' + v.charAt(0).toUpperCase() + v.slice(1);
  TCL_RENDERERS['Terminal/' + v] = {
    lab: kioskNamed(N + 'Homelab', function (c) { return tdsHomelab(v); }),
    sessions: kioskNamed(N + 'Sessions', function (c) { return tdsSessions(v); }),
    gpus: kioskNamed(N + 'Gpus', function (c) { return tdsGpus(v); }),
    notice: kioskNamed(N + 'Notice', function (c) { return tdsNotice(v); }),
    fluid: 'landscape',
  };
});
Object.assign(KIOSK_RENDERERS, TCL_RENDERERS);
