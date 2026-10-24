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
    if (t.active) return `<span${kioskTabAttrs(t)} style="background:${C.primary};color:${T.ink};font-weight:700;padding:0 ${gq(7)}">${k}:${t.key}*</span>`;
    const col = !t.live ? C.dim : t.att === 'crit' ? T.bad : t.att === 'warn' ? C.accent : T.soft2;
    return `<span${kioskTabAttrs(t)} style="padding:0 ${gq(7)};color:${col}">${k}:${t.key}${t.att ? '#' : ''}</span>`;
  }).join('');
  return bsFrame(`<div data-status="${worst}" style="position:absolute;inset:0;background:${C.background};font-family:${TERM_FONT};color:${C.primary};` +
      `font-size:${gq(19)};line-height:${gq(25)}">` +
    `<div style="position:absolute;left:0;right:0;top:0;height:${gq(34)};background:${T.bar};display:flex;align-items:center;white-space:pre;font-size:${gq(19)}">` +
      `<span style="padding:0 ${gq(8)};color:${C.primary};font-weight:700">[chiketi]</span>${win}` +
      `<span style="margin-left:auto;padding:0 ${gq(12)};color:${worst === 'crit' ? T.bad : worst === 'warn' ? C.accent : T.soft}">${D.short} ${D.hm}</span></div>` +
    panels + `</div>`, 'landscape', 'Terminal/' + v);
}
function tclPanel(C, x, y, w, h, title, right, lines) {
  return `<div style="position:absolute;left:${gq(x)};top:${gq(y)};width:${gq(w)};height:${gq(h)};box-sizing:border-box;background:${C.panel};` +
      `border:1px solid ${C.border};padding:${gq(6)} ${gq(12)};white-space:pre;overflow:hidden">` +
    `<div style="display:flex;gap:${gq(8)};color:${C.primary};white-space:nowrap"><span>──[ ${title} ]</span>` +
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
      roomy ? `<div style="font-size:${gq(23)};line-height:${gq(34)}">${iss}</div>` : iss));
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
    tclPanel(C, 8, 48 + th, 1008, H - 56 - th, 'LOAD', `util · vram · checked ${G.checked.toLowerCase()}`,
      roomy ? `<div style="font-size:${gq(23)};line-height:${gq(44)}">${bars}</div>` : bars));
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
Object.assign(KIOSK_RENDERERS, TCL_RENDERERS);
