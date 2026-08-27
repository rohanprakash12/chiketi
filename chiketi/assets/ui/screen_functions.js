
/* Display name for whichever LLM backend is live. llm.py reports
   'llama.cpp' | 'ollama' | 'vllm' in llama.backend; an Ollama or vLLM user
   should not see a panel titled LLAMA.CPP. Defined here rather than beside
   cleanModel() because cleanModel() is duplicated in display_app.js,
   control_app.js and the docs/site shim -- screen_functions.js is the single
   file all three hosts share, and the only consumer of this. */
function backendTitle() {
  const d = m('llama.backend');
  if (!d.available || !d.value || d.value === 'none') return 'AI ENGINE';
  // Object.create(null): a plain object literal would resolve '__proto__' or
  // 'toString' to prototype junk instead of falling through to the escaped
  // default.
  const names = Object.assign(Object.create(null), {
    'llama.cpp': 'LLAMA.CPP', ollama: 'OLLAMA', vllm: 'VLLM',
  });
  return names[String(d.value)] || esc(String(d.value).toUpperCase());
}

/* ── SVG Donut gauge ── */
function donut(pct, label, ringColor, size, sw, font, opts) {
  opts = opts || {};
  const bgRing = opts.bgRing || '#1a1a1a';
  const labelColor = opts.labelColor || '#aaa';
  const valColor = (pct > 80 ? (opts.critColor || '#BF0F0F') : (opts.valColor || '#fff'));
  const linecap = opts.linecap || 'round';
  const fontWeight = opts.fontWeight || '700';
  const labelFW = opts.labelFW || '600';
  const r = (size - sw - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const cx = size / 2, cy = size / 2;
  // Render size in cqw so the donut scales with its container instead of a
  // fixed px size. A fixed-px donut overflows in any frame narrower than the
  // 1024px kiosk (the control-panel preview and mobile), colliding with the
  // SECONDARY bar below. At 1024px this resolves to the original px size, so
  // the actual kiosk display is unchanged.
  // Gold uses anticlockwise (scale(-1,1)), Coral/Teal use clockwise (rotate(-90))
  const xform = opts.anticlockwise
    ? `translate(${size}, 0) scale(-1, 1) rotate(-90 ${cx} ${cy})`
    : `rotate(-90 ${cx} ${cy})`;
  // Opt-in tick ring. Off by default so every existing caller is unchanged.
  let ticks = '';
  if (opts.ticks) {
    for (let i = 0; i < 36; i++) {
      const a = i * 10 * Math.PI / 180, maj = i % 3 === 0;
      const r1 = r + sw / 2 + 3, r2 = r + sw / 2 + (maj ? 9 : 5);
      ticks += `<line x1="${(cx + r1 * Math.cos(a)).toFixed(1)}" y1="${(cy + r1 * Math.sin(a)).toFixed(1)}"` +
        ` x2="${(cx + r2 * Math.cos(a)).toFixed(1)}" y2="${(cy + r2 * Math.sin(a)).toFixed(1)}"` +
        ` stroke="${ringColor}" stroke-width="${maj ? 1.6 : 0.9}" opacity="${maj ? 0.75 : 0.35}"/>`;
    }
  }
  // The tick ring sits outside the circle radius, so the viewBox has to grow
  // or the outer ticks are clipped at the svg edge.
  const pad = opts.ticks ? 11 : 0;
  const vb = `${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}`;
  const cqv = ((size + pad * 2) / 1024 * 100).toFixed(3);
  return `<div style="text-align:center">` +
    (label ? `<div style="color:${labelColor};font-size:${opts.labelSize||'2.34cqw'};font-family:${font};font-weight:${labelFW};letter-spacing:1px;margin-bottom:2px;text-transform:uppercase">${label}</div>` : '') +
    `<svg width="${size}" height="${size}" viewBox="${vb}" style="width:${cqv}cqw;height:${cqv}cqw;max-width:100%;display:block;margin:0 auto">` + ticks +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${bgRing}" stroke-width="${sw}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ringColor}" stroke-width="${sw}" ` +
        `stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="${linecap}" ` +
        `transform="${xform}" style="transition:stroke-dashoffset 0.8s ease"/>` +
      `<text x="${cx}" y="${cy+2}" text-anchor="middle" dominant-baseline="central" ` +
        `fill="${valColor}" font-size="${opts.valSize||'3.22cqw'}" font-family="${font}" font-weight="${fontWeight}">${Math.round(pct)}%</text>` +
    `</svg></div>`;
}

/* ── Thermal scale with tick marks ──
 * The tick track is inset on both ends (`edge`) so the first/last labels (20
 * and 120) sit fully inside the panel instead of being clipped at the right
 * border. `marginLeft` aligns the track start with the thermBar fill (label
 * column width + the row gap); a matching right inset keeps spacing even. */
function thermalScale(tickColor, font, marginLeft) {
  const marks = [20, 50, 70, 90, 110, 120];
  const edge = '1.4cqw'; // half-width of an end label, kept clear of the panel edge
  let html = `<div style="margin-left:${marginLeft||'5.57cqw'};margin-right:${edge};position:relative;height:2.34cqw">` +
    `<div style="position:absolute;top:0;left:0;right:0;height:1px;background:#333"></div>`;
  for (const t of marks) {
    const pct = ((t - 20) / 100) * 100;
    html += `<div style="position:absolute;left:${pct}%;top:0;transform:translateX(-50%)">` +
      `<div style="width:1px;height:0.78cqw;background:${tickColor}"></div>` +
      `<div style="color:${tickColor};font-size:1.37cqw;font-family:${font};text-align:center;margin-top:1px">${t}</div></div>`;
  }
  return html + `</div>`;
}

/* ── Spinning fan icon — speed scales with actual RPM ── */
function fanIcon(color, size, rpm) {
  if (!rpm || rpm <= 0) {
    // Stopped fan — static, dimmed
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" style="opacity:0.3">` +
      [0,90,180,270].map(a => `<path d="M20 20 C18 10,12 4,20 2 C28 4,22 10,20 20Z" fill="${color}" transform="rotate(${a} 20 20)"/>`).join('') +
      `<circle cx="20" cy="20" r="4" fill="#111" stroke="${color}" stroke-width="1"/></svg>`;
  }
  // Animation speed: ~10% of real RPM feel
  // 1000 RPM → ~1.7 rps → 0.6s per revolution
  // 500 RPM → ~0.83 rps → 1.2s per revolution
  const rps = (rpm / 60) * 0.1;
  const speed = Math.max(0.3, 1 / Math.max(0.1, rps));
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" style="animation:spin ${speed.toFixed(2)}s linear infinite">` +
    [0,90,180,270].map(a => `<path d="M20 20 C18 10,12 4,20 2 C28 4,22 10,20 20Z" fill="${color}" opacity="0.9" transform="rotate(${a} 20 20)"/>`).join('') +
    `<circle cx="20" cy="20" r="4" fill="#111" stroke="${color}" stroke-width="1"/></svg>`;
}

/* ── Fan strip (dynamic — grouped by CPU / CASE / GPU) ── */
function fanStrip(fanColor, font, bgColor) {
  const cpuFans = m('cpu.fans_cpu');
  const caseFans = m('cpu.fans_case');
  const gpuFan = m('gpu.fan');
  const cpuList = asList(cpuFans);
  const caseList = asList(caseFans);
  let html = `<div style="display:flex;align-items:center;gap:0.88cqw;${bgColor ? 'background:'+bgColor+';border-radius:3px;padding:0.44cqw 1.17cqw;' : ''}">`;
  let shown = 0;
  if (cpuList.length) {
    html += `<span style="color:${fanColor};font-size:1.76cqw;font-family:${font};font-weight:700;opacity:0.7">CPU</span>`;
    for (const rpm of cpuList) { html += fanIcon(fanColor, '2.93cqw', rpm); shown++; }
  }
  if (caseList.length) {
    if (shown) html += `<div style="width:0.59cqw"></div>`;
    html += `<span style="color:${fanColor};font-size:1.76cqw;font-family:${font};font-weight:700;opacity:0.7">CASE</span>`;
    for (const rpm of caseList) { html += fanIcon(fanColor, '2.93cqw', rpm); shown++; }
  }
  if (gpuFan.available) {
    if (shown) html += `<div style="width:0.59cqw"></div>`;
    html += `<span style="color:${fanColor};font-size:1.76cqw;font-family:${font};font-weight:700;opacity:0.7">GPU</span>`;
    html += fanIcon(fanColor, '2.93cqw', gpuFan.value * 10);
    shown++;
  }
  if (!shown) html += `<span style="color:${fanColor};font-size:1.76cqw;font-family:${font};opacity:0.4">NO FANS DETECTED</span>`;
  html += `</div>`;
  return html;
}

function terminalScreen1(c) {
  const cpuTemp = m('cpu.temp'), cpuUsage = m('cpu.usage');
  const cores = m('cpu.per_core');
  const gpuTemp = m('gpu.temp'), gpuFan = m('gpu.fan'), gpuPower = m('gpu.power');
  const gpuVram = m('gpu.vram_used'), gpuVramPct = m('gpu.vram_percent'), gpuUtil = m('gpu.util');
  const ramUsed = m('mem.ram_used'), ramPct = m('mem.ram_percent');
  const swapUsed = m('mem.swap_used'), swapPct = m('mem.swap_percent');
  const diskRoot = m('disk.root_used'), diskRootPct = m('disk.root_percent');
  const diskHome = m('disk.home_used'), diskHomePct = m('disk.home_percent');
  const dl = m('net.dl'), ul = m('net.ul');
  const hostname = m('sys.hostname'), uptime = m('sys.uptime');

  const coresStr = cores.available && Array.isArray(cores.value)
    ? cores.value.slice(0, 8).map(v => Math.round(v)).join(' ') + (cores.value.length > 8 ? ' ...' : '')
    : 'N/A';
  const fanStr = gpuFan.available ? `  Fan: ${gpuFan.value}%` : '';
  const powerStr = gpuPower.available ? `${gpuPower.value}W / ${gpuPower.extra.limit || '?'}W` : 'N/A';
  const vramG = gpuVram.available ? `${(gpuVram.value/1024).toFixed(1)}/${((gpuVram.extra.total||0)/1024).toFixed(1)}G` : 'N/A';
  const ramStr = ramUsed.available ? `${ramUsed.value}/${ramUsed.extra.total || '?'}G` : 'N/A';
  const swapStr = swapUsed.available ? `${swapUsed.value}/${swapUsed.extra.total || '?'}G` : 'N/A';
  const rootStr = diskRoot.available ? `${diskRoot.value}/${diskRoot.extra.total || '?'}${(diskRoot.unit||'')[0]||'G'}` : 'N/A';
  const homeStr = diskHome.available ? `${diskHome.value}/${diskHome.extra.total || '?'}${(diskHome.unit||'')[0]||'G'}` : 'N/A';

  return `<div class="screen-frame"><div class="t-screen t-2col-3row" style="background:${c.background}">` +
    tPanel(c, 'CPU',
      tRow(c, 'Temp:', '', cpuTemp.available ? cpuTemp.value + '\u00b0C' : 'N/A') +
      tRow(c, 'Load:', tBar(c, cpuUsage.available ? cpuUsage.value : null), cpuUsage.available ? Math.round(cpuUsage.value) + '%' : 'N/A') +
      tRow(c, 'Fans:', '', (function(){ var cpuF=m('cpu.fans_cpu'),caseF=m('cpu.fans_case'),parts=[]; var cl=asList(cpuF),ca=asList(caseF); if(cl.length)parts.push('CPU:'+cl.filter(function(r){return r>0}).length); if(ca.length)parts.push('Case:'+ca.filter(function(r){return r>0}).length); var gpuF=m('gpu.fan'); if(gpuF.available)parts.push('GPU:'+(gpuF.value>0?'On':'Off')); return parts.length?parts.join(' | '):'N/A'; })(), c.dim) +
      tRow(c, 'Cores:', '', coresStr, c.dim)
    ) +
    tPanel(c, 'GPU',
      tRow(c, 'Temp:', '', gpuTemp.available ? gpuTemp.value + '\u00b0C' + fanStr : 'N/A') +
      tRow(c, 'Power:', '', powerStr) +
      tRow(c, 'VRAM:', tBar(c, gpuVramPct.available ? gpuVramPct.value : null), vramG) +
      tRow(c, 'Util:', tBar(c, gpuUtil.available ? gpuUtil.value : null), gpuUtil.available ? gpuUtil.value + '%' : 'N/A')
    ) +
    tPanel(c, 'MEMORY',
      tRow(c, 'RAM:', tBar(c, ramPct.available ? ramPct.value : null), ramStr) +
      tRow(c, 'Swap:', tBar(c, swapPct.available ? swapPct.value : null), swapStr)
    ) +
    tPanel(c, 'DISK',
      tRow(c, '/', tBar(c, diskRootPct.available ? diskRootPct.value : null), rootStr) +
      tRow(c, '/home', tBar(c, diskHomePct.available ? diskHomePct.value : null), homeStr)
    ) +
    tPanel(c, 'NETWORK',
      tRow(c, '\u2193', '', dl.available ? dl.value + ' ' + dl.unit : 'N/A') +
      tRow(c, '\u2191', '', ul.available ? ul.value + ' ' + ul.unit : 'N/A')
    ) +
    tPanel(c, 'SYSTEM',
      tRow(c, 'Host:', '', mv('sys.hostname')) +
      tRow(c, 'Up:', '', mv('sys.uptime'), c.dim)
    ) +
    `</div></div>`;
}

function terminalScreen2(c) {
  const gpuName = m('gpu.name'), gpuUtil = m('gpu.util');
  const vram = m('gpu.vram_used'), vramPct = m('gpu.vram_percent');
  const gpuTemp = m('gpu.temp'), gpuPower = m('gpu.power');
  const gpuClk = m('gpu.clock_gpu'), memClk = m('gpu.clock_mem'), memUtil = m('gpu.mem_util');
  const procs = m('gpu.processes');
  const llamaStatus = m('llama.status'), llamaHealth = m('llama.health'), llamaModel = m('llama.model');

  const nameStr = gpuName.available ? esc(String(gpuName.value)) : 'GPU Not Detected';
  const vramStr = vram.available ? `${vram.value}/${vram.extra.total || '?'} MiB` : 'N/A';
  let tempPowerStr = 'N/A';
  if (gpuTemp.available) {
    tempPowerStr = gpuTemp.value + '\u00b0C';
    if (gpuPower.available) tempPowerStr += `      Power: ${gpuPower.value}W / ${gpuPower.extra.limit||'?'}W`;
  }
  let clockStr = 'N/A';
  if (gpuClk.available) {
    clockStr = `${gpuClk.value}/${gpuClk.extra.max||'?'} MHz`;
    if (memClk.available) clockStr += `  Mem: ${memClk.value}/${memClk.extra.max||'?'} MHz`;
  }

  let procRows = `<div class="t-row" style="color:${c.dim};font-size:12px">PID       Name              VRAM</div>`;
  if (procs.available && Array.isArray(procs.value)) {
    for (const p of procs.value.slice(0, 5)) {
      const pid = esc(String(p.pid || '')).padEnd(10);
      const name = esc(String(p.name || '')).padEnd(18);
      const mem = (p.vram_mib || p.vram || p.used_memory || '?') + ' MiB';
      procRows += `<div class="t-row" style="color:${c.primary};font-size:12px">${pid}${name}${mem}</div>`;
    }
  } else {
    procRows += `<div class="t-row" style="color:${c.dim};font-size:12px">No processes</div>`;
  }

  let statusText = 'Unknown';
  if (llamaStatus.available) {
    if (llamaStatus.value === 'Running') {
      statusText = llamaHealth.available ? `Running (${esc(String(llamaHealth.value))})` : 'Running';
    } else statusText = 'Stopped';
  }

  return `<div class="screen-frame"><div class="t-screen t-1col-3row" style="background:${c.background}">` +
    tPanel(c, 'GPU PERFORMANCE',
      `<div class="t-row" style="color:${c.accent};font-size:13px">${nameStr}</div>` +
      tRow(c, 'Utilization:', tBar(c, gpuUtil.available ? gpuUtil.value : null), gpuUtil.available ? gpuUtil.value + '%' : 'N/A') +
      tRow(c, 'VRAM:', tBar(c, vramPct.available ? vramPct.value : null), vramStr) +
      tRow(c, 'Temperature:', '', tempPowerStr) +
      tRow(c, 'GPU Clock:', '', clockStr) +
      tRow(c, 'Mem BW Util:', tBar(c, memUtil.available ? memUtil.value : null), memUtil.available ? memUtil.value + '%' : 'N/A')
    ) +
    tPanel(c, 'CUDA PROCESSES', procRows) +
    tPanel(c, backendTitle(),
      tRow(c, 'Status:', '', statusText) +
      tRow(c, 'Model:', '', cleanModel()) +
      tRow(c, 'Quant:', '', mv('llama.quant')) +
      tRow(c, 'Context:', '', mv('llama.context'))
    ) +
    `</div></div>`;
}

function panelGoldScreen2(c) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const dayName = days[now.getDay()];
  const dateStr = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  return `<div class="screen-frame"><div style="background:#000;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Chakra Petch',sans-serif">` +
    `<div style="color:${GOLD};font-size:2.05cqw;text-transform:uppercase;letter-spacing:1.17cqw;margin-bottom:0.88cqw">United Federation of Planets</div>` +
    `<div style="border:2px solid ${GOLD};padding:2.05cqw 7.32cqw;position:relative">` +
      `<div style="position:absolute;top:-1.32cqw;left:3.52cqw;background:#000;padding:0 1.46cqw;color:${AMBER};font-size:1.76cqw;letter-spacing:0.29cqw">SHIP CHRONOMETER</div>` +
      `<div style="display:flex;align-items:baseline">` +
        `<span style="color:${GOLD};font-size:19.53cqw;font-weight:700">${hh}</span>` +
        `<span style="color:${GOLD};font-size:13.67cqw;animation:blink 1s infinite;margin:0 0.29cqw">:</span>` +
        `<span style="color:${GOLD};font-size:19.53cqw;font-weight:700">${mm}</span>` +
        `<span style="color:${AMBER};font-size:8.79cqw;margin-left:1.46cqw">${ss}</span>` +
      `</div>` +
    `</div>` +
    `<div style="color:${GREEN};font-size:4.69cqw;letter-spacing:0.88cqw;margin-top:2.64cqw;text-transform:uppercase">${dayName}</div>` +
    `<div style="color:#ddd;font-size:5.57cqw;letter-spacing:0.44cqw;margin-top:0.88cqw">${dateStr}</div>` +
  `</div></div>`;
}

function panelCoralScreen2(c) {
  const T = PANEL_SPEC.coral || {};
  const FONT = "'Antonio', sans-serif";
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const dayName = days[now.getDay()];
  const dateStr = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  const ank = T.anakiwa || '#99CCFF';
  const gt = T.goldenTanoi || '#FFCC66';
  const nc = T.neonCarrot || '#FF9933';
  const tn = T.tanoi || '#FFCC99';
  const li = T.lilac || '#CC99CC';

  return `<div class="screen-frame"><div style="background:#000;width:100%;height:100%;display:flex;font-family:${FONT}">` +
    `<div style="width:7.32cqw;flex-shrink:0;display:flex;flex-direction:column">` +
      `<div style="height:4.10cqw;background:${ank};border-bottom-left-radius:2.93cqw"></div>` +
      `<div style="flex:1;display:flex;flex-direction:column;gap:0.44cqw;padding-top:0.88cqw">` +
        `<div style="background:${gt};height:3.52cqw;border-top-right-radius:999px;border-bottom-right-radius:999px;width:6.74cqw"></div>` +
        `<div style="background:${nc};height:3.52cqw;border-top-right-radius:999px;border-bottom-right-radius:999px;width:6.74cqw"></div>` +
        `<div style="flex:1"></div>` +
        `<div style="background:${li};height:3.52cqw;border-top-right-radius:999px;border-bottom-right-radius:999px;width:6.74cqw"></div>` +
      `</div>` +
      `<div style="height:2.93cqw;background:${ank};border-top-left-radius:2.34cqw"></div>` +
    `</div>` +
    `<div style="flex:1;display:flex;flex-direction:column">` +
      `<div style="height:4.10cqw;background:${ank};display:flex;align-items:center;justify-content:flex-end;padding-right:1.76cqw"><span style="color:#000;font-size:2.64cqw;text-transform:uppercase;letter-spacing:0.44cqw">UNITED FEDERATION OF PLANETS</span></div>` +
      `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center">` +
        `<div style="display:flex;align-items:baseline"><span style="color:${gt};font-size:19.53cqw;letter-spacing:0.59cqw">${hh}</span><span style="color:${nc};font-size:13.67cqw;animation:blink 1s infinite;margin:0 0.59cqw">:</span><span style="color:${gt};font-size:19.53cqw;letter-spacing:0.59cqw">${mm}</span><span style="color:${tn};font-size:8.79cqw;margin-left:1.76cqw">${ss}</span></div>` +
        `<div style="color:${ank};font-size:4.69cqw;letter-spacing:1.17cqw;margin-top:1.17cqw;text-transform:uppercase">${dayName}</div>` +
        `<div style="color:${li};font-size:5.57cqw;letter-spacing:0.59cqw;margin-top:0.59cqw">${dateStr}</div>` +
      `</div>` +
      `<div style="height:2.93cqw;background:${ank};display:flex;align-items:center;justify-content:flex-end;padding-right:1.76cqw"><span style="color:#000;font-size:1.90cqw;letter-spacing:0.29cqw">SHIP CHRONOMETER</span></div>` +
    `</div>` +
  `</div></div>`;
}

function panelTealScreen2(c) {
  const D = PANEL_SPEC.teal || {};
  const FONT = "'Rajdhani', sans-serif";
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const dayName = days[now.getDay()];
  const dateStr = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  const bg = D.void || '#111419';
  const tl = D.teal || '#2A9D8F';
  const bn = D.burnt || '#E7442A';
  const st = D.steel || '#9EA5BA';
  const pl = D.pale || '#AAAACC';
  const lv = D.lavender || '#8888BB';

  return `<div class="screen-frame"><div style="background:${bg};width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:${FONT}">` +
    `<div style="display:flex;width:80%;align-items:center;gap:0;margin-bottom:1.17cqw">` +
      `<div style="flex:1;height:0.29cqw;background:${tl};opacity:0.4"></div>` +
      `<svg width="2.05cqw" height="2.05cqw" viewBox="0 0 14 14"><polygon points="0,14 14,0 14,14" fill="${tl}" opacity="0.6"/></svg>` +
      `<div style="padding:0 1.76cqw"><span style="color:${tl};font-size:2.05cqw;font-weight:600;text-transform:uppercase;letter-spacing:0.88cqw">BAJORAN SECTOR</span></div>` +
      `<svg width="2.05cqw" height="2.05cqw" viewBox="0 0 14 14"><polygon points="0,0 14,14 0,14" fill="${tl}" opacity="0.6"/></svg>` +
      `<div style="flex:1;height:0.29cqw;background:${tl};opacity:0.4"></div>` +
    `</div>` +
    `<div style="display:flex;align-items:baseline"><span style="color:${pl};font-size:19.53cqw;font-weight:600;letter-spacing:0.59cqw">${hh}</span><span style="color:${bn};font-size:13.67cqw;animation:blink 1s infinite;margin:0 0.59cqw">:</span><span style="color:${pl};font-size:19.53cqw;font-weight:600;letter-spacing:0.59cqw">${mm}</span><span style="color:${st};font-size:8.79cqw;margin-left:1.76cqw">${ss}</span></div>` +
    `<div style="color:${tl};font-size:4.69cqw;letter-spacing:1.17cqw;margin-top:1.46cqw;text-transform:uppercase;font-weight:600">${dayName}</div>` +
    `<div style="color:${lv};font-size:5.57cqw;letter-spacing:0.59cqw;margin-top:0.59cqw;font-weight:500">${dateStr}</div>` +
    `<div style="display:flex;width:80%;align-items:center;gap:0;margin-top:1.76cqw">` +
      `<div style="flex:1;height:0.29cqw;background:${bn};opacity:0.3"></div>` +
      `<svg width="1.46cqw" height="1.46cqw" viewBox="0 0 10 10"><polygon points="0,10 10,0 10,10" fill="${bn}" opacity="0.5"/></svg>` +
      `<div style="padding:0 1.46cqw"><span style="color:${st};font-size:1.76cqw;font-weight:600;letter-spacing:0.44cqw">STATION CHRONOMETER</span></div>` +
      `<svg width="1.46cqw" height="1.46cqw" viewBox="0 0 10 10"><polygon points="0,0 10,10 0,10" fill="${bn}" opacity="0.5"/></svg>` +
      `<div style="flex:1;height:0.29cqw;background:${bn};opacity:0.3"></div>` +
    `</div>` +
  `</div></div>`;
}

/* ═══════════════════════════════════════
   VINTAGE / SCANLINES
   ═══════════════════════════════════════ */

function scanGlow(color, spread) {
  spread = spread || 4;
  return 'color:' + color + ';text-shadow:0 0 ' + spread + 'px ' + color + ', 0 0 ' + (spread*2) + 'px ' + color + '66';
}

function scanSectionLabel(text, color, rightText, rightColor) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.59cqw">' +
    '<span style="' + scanGlow(color, 4) + ';font-size:1.95cqw;font-family:\'Share Tech Mono\',monospace;letter-spacing:3px">' + text + '</span>' +
    '<div style="flex:1;height:1px;background:' + color + '33;margin:0 1.17cqw"></div>' +
    (rightText ? '<span style="' + scanGlow(rightColor||color, 3) + ';font-size:1.95cqw;font-family:\'Share Tech Mono\',monospace;letter-spacing:2px">' + rightText + '</span>' : '') +
  '</div>';
}

function scanDonut(pct, label, color, size) {
  const S = PANEL_SPEC.scanlines || {};
  const F = "'Share Tech Mono', monospace";
  const dim = S.dim || '#334455';
  const red = S.red || '#FF3344';
  const sw = size * 0.07;
  const r = (size - sw - 6) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const valColor = pct > 80 ? red : color;
  const cx = size / 2, cy = size / 2;
  return '<div style="text-align:center">' +
    '<div style="' + scanGlow(color, 3) + ';font-size:2.34cqw;font-family:' + F + ';letter-spacing:2px;margin-bottom:2px">' + label + '</div>' +
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="filter:drop-shadow(0 0 4px ' + color + '66)">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + dim + '" stroke-width="' + sw + '"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '" ' +
        'stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" stroke-linecap="butt" ' +
        'transform="rotate(-90 ' + cx + ' ' + cy + ')" style="transition:stroke-dashoffset 0.8s ease;filter:drop-shadow(0 0 3px ' + color + ')"/>' +
      '<text x="' + cx + '" y="' + (cy+2) + '" text-anchor="middle" dominant-baseline="central" ' +
        'fill="' + valColor + '" font-size="3.81cqw" font-family="' + F + '" style="filter:drop-shadow(0 0 4px ' + valColor + ')">' + Math.round(pct) + '%</text>' +
    '</svg></div>';
}

function scanThermBar(label, temp) {
  const S = PANEL_SPEC.scanlines || {};
  const F = "'Share Tech Mono', monospace";
  const cyan = S.cyan || '#00FFCC';
  const dim = S.dim || '#334455';
  const pct = Math.max(0, Math.min(100, ((temp-20)/100)*100));
  let fillColor = S.blue || '#4488FF';
  if (temp >= 90) fillColor = S.red || '#FF3344';
  else if (temp >= 70) fillColor = S.amber || '#FFAA00';
  else if (temp >= 50) fillColor = S.green || '#00FF88';
  const thermFlash = temp >= 100 ? ';animation:blink 0.5s infinite' : '';
  return '<div style="display:flex;align-items:center;gap:0.88cqw">' +
    '<span style="' + scanGlow(cyan, 3) + ';font-size:2.34cqw;font-family:' + F + ';width:4.69cqw;text-align:right;flex-shrink:0">' + label + '</span>' +
    '<div style="flex:1;height:2.64cqw;background:' + dim + ';border-radius:1px;overflow:hidden">' +
      '<div style="height:100%;width:' + pct + '%;background:' + fillColor + ';border-radius:1px;transition:width 0.8s ease,background 0.5s ease;box-shadow:0 0 4px ' + fillColor + ',0 0 8px ' + fillColor + '44' + thermFlash + '"></div>' +
    '</div></div>';
}

function scanScreen1(c) {
  const S = PANEL_SPEC.scanlines || {};
  const F = "'Share Tech Mono', monospace";
  const cyan = S.cyan || '#00FFCC';
  const amber = S.amber || '#FFAA00';
  const green = S.green || '#00FF88';
  const blue = S.blue || '#4488FF';
  const red = S.red || '#FF3344';
  const cyanDim = S.cyanDim || '#009977';
  const dim = S.dim || '#334455';
  const bg = S.bg || '#060810';
  const cpuUsage = m('cpu.usage'), ramPct = m('mem.ram_percent');
  const diskRootPct = m('disk.root_percent');
  const diskHome = m('disk.home_used'), diskHomePct = m('disk.home_percent');
  const cpuTemp = m('cpu.temp'), mbTemp = m('cpu.mb_temp'), gpuTemp = m('gpu.temp');
  const ip = m('net.ip'), mac = m('net.mac'), netSpeed = m('net.speed');
  const dl = m('net.dl'), ul = m('net.ul');
  const llamaModel = m('llama.model'), tokSec = m('llama.tok_per_sec');
  const vramUsed = m('gpu.vram_used'), vramTotal = m('gpu.vram_total');
  const vramStr = vramUsed.available && vramTotal.available ? (vramUsed.value > 100 ? (vramUsed.value/1024).toFixed(1) : vramUsed.value) + '/' + (vramTotal.value > 100 ? Math.round(vramTotal.value/1024) : vramTotal.value) : '--';
  const speedStr = netSpeed.available ? (netSpeed.value >= 1000 ? Math.floor(netSpeed.value/1000) + ' GBPS' : netSpeed.value + ' MBPS') : '--';
  const hostname = m('sys.hostname');
  const hostStr = hostname.available ? esc(String(hostname.value).toUpperCase()) : '--';
  const temps = [cpuTemp.available?cpuTemp.value:0, mbTemp.available?mbTemp.value:0, gpuTemp.available?gpuTemp.value:0];
  const anyDanger = temps.some(t => t >= 110);
  const anyOrange = temps.some(t => t >= 90);
  const thermalStatus = anyDanger ? 'CRITICAL' : anyOrange ? 'WARNING' : 'NOMINAL';
  const thermalStatusColor = anyDanger ? red : anyOrange ? amber : green;
  const secPct = diskHome.available && diskHomePct.available ? diskHomePct.value : 0;

  return '<div class="screen-frame"><div style="background:' + bg + ';width:100%;height:100%;position:relative;padding:0.88cqw;display:flex;flex-direction:column;gap:0.59cqw">' +
    /* Scanline overlay */
    '<div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.08) 2px,rgba(0,0,0,0.08) 4px);z-index:10"></div>' +
    /* Row 1: Headers */
    '<div style="display:flex;gap:1.17cqw">' +
      '<div style="flex:1">' + scanSectionLabel('CORE SYSTEMS', cyan, hostStr) + '</div>' +
      '<div style="flex:1">' + scanSectionLabel('THERMALS', amber, thermalStatus, thermalStatusColor) + '</div>' +
    '</div>' +
    /* Row 2: Donuts | Bars */
    '<div style="display:flex;gap:1.17cqw;flex:1">' +
      '<div style="flex:1;display:flex;justify-content:space-around;align-items:center">' +
        scanDonut(cpuUsage.available?cpuUsage.value:0, 'CPU', amber, 170) +
        scanDonut(ramPct.available?ramPct.value:0, 'RAM', cyan, 170) +
        scanDonut(diskRootPct.available?diskRootPct.value:0, 'SSD', green, 170) +
      '</div>' +
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:0.88cqw">' +
        scanThermBar('CPU', cpuTemp.available?cpuTemp.value:20) +
        scanThermBar('MB', mbTemp.available?mbTemp.value:20) +
        scanThermBar('GPU', gpuTemp.available?gpuTemp.value:20) +
        thermalScale(cyanDim, F) +
      '</div>' +
    '</div>' +
    /* Row 3: Secondary | Fans */
    '<div style="display:flex;gap:1.17cqw;align-items:center">' +
      '<div style="flex:1">' +
        (diskHome.available ?
          '<div style="position:relative;height:2.64cqw;background:' + dim + ';border-radius:1px;overflow:hidden">' +
            '<div style="position:absolute;top:0;left:0;height:100%;width:' + secPct + '%;background:' + green + ';border-radius:1px;transition:width 0.8s ease;box-shadow:0 0 3px ' + green + ',0 0 6px ' + green + '44"></div>' +
            '<div style="position:absolute;top:0;left:0;right:0;height:100%;display:flex;justify-content:space-between;align-items:center;padding:0 1.17cqw;font-family:' + F + ';font-size:1.46cqw;color:' + bg + '">' +
              '<span>SECONDARY</span><span>' + fmtCapacity(diskHome) + ' / ' + fmtCapacityTotal(diskHome) + '</span></div>' +
          '</div>' :
          '<div style="height:2.64cqw;background:' + dim + ';border-radius:1px;display:flex;align-items:center;justify-content:center;font-family:' + F + ';font-size:1.46cqw;color:' + dim + '">SECONDARY \u2014 NONE</div>') +
      '</div>' +
      '<div style="flex:1;display:flex;justify-content:center;align-items:center;gap:0.88cqw">' +
        fanStrip(cyan, F, '') +
      '</div>' +
    '</div>' +
    /* Row 4: Headers */
    '<div style="display:flex;gap:1.17cqw">' +
      '<div style="flex:1">' + scanSectionLabel('COMMS', blue, speedStr) + '</div>' +
      '<div style="flex:1">' + scanSectionLabel('NPU', amber, backendTitle()) + '</div>' +
    '</div>' +
    /* Row 5+6: Data */
    '<div style="display:flex;gap:1.17cqw;flex:1">' +
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between">' +
        '<div style="display:flex;flex-direction:column;gap:0.29cqw">' +
          '<div style="display:flex;justify-content:space-between"><span style="' + scanGlow(cyanDim, 2) + ';font-size:2.64cqw;font-family:' + F + '">IP</span><span style="' + scanGlow(cyan, 4) + ';font-size:4.69cqw;font-family:' + F + '">' + (ip.available?esc(String(ip.value)):'N/A') + '</span></div>' +
          '<div style="display:flex;justify-content:space-between"><span style="' + scanGlow(cyanDim, 2) + ';font-size:2.64cqw;font-family:' + F + '">MAC</span><span style="' + scanGlow(cyan, 4) + ';font-size:4.69cqw;font-family:' + F + '">' + (mac.available?esc(String(mac.value)):'N/A') + '</span></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div style="display:flex;align-items:center;gap:0.59cqw"><span style="' + scanGlow(green, 4) + ';font-size:1.76cqw;font-family:' + F + '">\u25B2</span><span style="' + scanGlow(green, 4) + ';font-size:4.98cqw;font-family:' + F + '">' + (ul.available?ul.value+' '+ul.unit:'0') + '</span></div>' +
          '<div style="display:flex;align-items:center;gap:0.59cqw"><span style="' + scanGlow(blue, 4) + ';font-size:1.76cqw;font-family:' + F + '">\u25BC</span><span style="' + scanGlow(blue, 4) + ';font-size:4.98cqw;font-family:' + F + '">' + (dl.available?dl.value+' '+dl.unit:'0') + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between">' +
        '<div style="display:flex;flex-direction:column;gap:0.29cqw">' +
          '<div style="display:flex;justify-content:space-between"><span style="' + scanGlow(cyanDim, 2) + ';font-size:2.64cqw;font-family:' + F + '">MODEL</span><span style="' + scanGlow(amber, 4) + ';font-size:3.81cqw;font-family:' + F + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right">' + cleanModel() + '</span></div>' +
          '<div style="display:flex;justify-content:space-between"><span style="' + scanGlow(cyanDim, 2) + ';font-size:2.64cqw;font-family:' + F + '">QUANT</span><span style="' + scanGlow(amber, 4) + ';font-size:3.81cqw;font-family:' + F + '">' + mv('llama.quant') + '</span></div>' +
          '<div style="display:flex;justify-content:space-between"><span style="' + scanGlow(cyanDim, 2) + ';font-size:2.64cqw;font-family:' + F + '">CTX</span><span style="' + scanGlow(amber, 4) + ';font-size:3.81cqw;font-family:' + F + '">' + mv('llama.context') + '</span></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
          '<div><span style="' + scanGlow(cyanDim, 2) + ';font-size:2.64cqw;font-family:' + F + '">T/S </span><span style="' + scanGlow(cyan, 5) + ';font-size:4.98cqw;font-family:' + F + '">' + (tokSec.available?Math.round(tokSec.value):'--') + '</span></div>' +
          '<div><span style="' + scanGlow(cyanDim, 2) + ';font-size:2.64cqw;font-family:' + F + '">VRAM </span><span style="' + scanGlow(cyan, 5) + ';font-size:4.98cqw;font-family:' + F + '">' + vramStr + '</span></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div></div>';
}

function scanScreen2(c) {
  const S = PANEL_SPEC.scanlines || {};
  const F = "'Share Tech Mono', monospace";
  const cyan = S.cyan || '#00FFCC';
  const cyanDim = S.cyanDim || '#009977';
  const amber = S.amber || '#FFAA00';
  const green = S.green || '#00FF88';
  const bg = S.bg || '#060810';
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const dayName = days[now.getDay()];
  const dateStr = months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();

  return '<div class="screen-frame"><div style="background:' + bg + ';width:100%;height:100%;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:' + F + '">' +
    '<div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.08) 2px,rgba(0,0,0,0.08) 4px);z-index:10"></div>' +
    '<div style="' + scanGlow(cyanDim, 3) + ';font-size:1.76cqw;letter-spacing:8px;margin-bottom:1.76cqw">VACUUM FLUORESCENT CHRONOMETER</div>' +
    '<div style="display:flex;align-items:baseline">' +
      '<span style="' + scanGlow(cyan, 10) + ';font-size:21.48cqw;letter-spacing:6px">' + hh + '</span>' +
      '<span style="' + scanGlow(amber, 8) + ';font-size:14.65cqw;animation:blink 1s infinite;margin:0 0.29cqw">:</span>' +
      '<span style="' + scanGlow(cyan, 10) + ';font-size:21.48cqw;letter-spacing:6px">' + mm + '</span>' +
      '<span style="' + scanGlow(green, 6) + ';font-size:9.77cqw;margin-left:1.76cqw">' + ss + '</span>' +
    '</div>' +
    '<div style="' + scanGlow(amber, 5) + ';font-size:4.69cqw;letter-spacing:10px;margin-top:1.46cqw">' + dayName + '</div>' +
    '<div style="' + scanGlow(cyan, 4) + ';font-size:5.27cqw;letter-spacing:4px;margin-top:0.59cqw">' + dateStr + '</div>' +
    '<div style="display:flex;align-items:center;gap:1.17cqw;margin-top:2.34cqw;width:70%">' +
      '<div style="flex:1;height:1px;background:' + cyan + ';opacity:0.15;box-shadow:0 0 2px ' + cyan + '"></div>' +
      '<div style="width:0.88cqw;height:0.88cqw;border-radius:50%;background:' + green + ';box-shadow:0 0 4px ' + green + ',0 0 8px ' + green + '44"></div>' +
      '<div style="width:0.88cqw;height:0.88cqw;border-radius:50%;background:' + amber + ';box-shadow:0 0 4px ' + amber + ',0 0 8px ' + amber + '44"></div>' +
      '<div style="width:0.88cqw;height:0.88cqw;border-radius:50%;background:' + cyan + ';box-shadow:0 0 4px ' + cyan + ',0 0 8px ' + cyan + '44"></div>' +
      '<div style="flex:1;height:1px;background:' + cyan + ';opacity:0.15;box-shadow:0 0 2px ' + cyan + '"></div>' +
    '</div>' +
  '</div></div>';
}

/* ═══════════════════════════════════════
   VINTAGE / TUBES (Nixie + Magic Eye + IN-13 Bargraph + Dekatron)
   ═══════════════════════════════════════ */

function nixieDigit(value, size, showTube) {
  const N = PANEL_SPEC.tubes || {};
  const NIXIE = "'Nixie One', cursive";
  const bright = N.bright || '#FF6E0B';
  const bloom = N.bloom || '#FF4400';
  const glass = N.glass || '#332818';
  const cathode = N.cathode || '#1A1410';
  const bg = N.bg || '#0A0806';
  const glassTint = N.glassTint || '#181210';
  const mesh = N.mesh || '#332820';

  const chars = String(value).split('');
  let html = '<span style="display:inline-flex;gap:' + (showTube ? '3px' : '0') + '">';
  for (let ci = 0; ci < chars.length; ci++) {
    const ch = chars[ci];
    const isDigit = /\d/.test(ch);
    const tubeW = showTube ? (size * 0.7) : '';
    const tubeH = showTube ? (size * 1.3) : '';
    const tubeBg = showTube
      ? 'radial-gradient(ellipse at 40% 35%, rgba(255,68,0,0.04) 0%, ' + bg + ' 60%), linear-gradient(180deg, ' + glassTint + '88 0%, ' + bg + '22 10%, ' + bg + '11 20%, ' + bg + '11 80%, ' + bg + '22 90%, ' + glassTint + '88 100%)'
      : 'linear-gradient(180deg, ' + glassTint + '55 0%, transparent 20%, transparent 80%, ' + glassTint + '55 100%)';
    const tubeBorder = showTube ? '1px solid ' + glass + '55' : '1px solid ' + glass + '33';
    const tubeBorderBottom = showTube ? 'border-bottom:3px solid ' + glass + '88;' : '';
    const tubeRadius = showTube ? 'border-radius:' + (size*0.3) + 'px ' + (size*0.3) + 'px 4px 4px;' : 'border-radius:2px;';
    const tubeBoxShadow = showTube ? 'box-shadow:inset 0 0 ' + (size*0.4) + 'px rgba(255,68,0,0.07),inset 0 0 ' + (size*0.15) + 'px rgba(255,100,34,0.1),inset 0 ' + (size*0.15) + 'px ' + (size*0.3) + 'px rgba(0,0,0,0.4),0 0 ' + (size*0.25) + 'px rgba(255,68,0,0.1);' : '';

    html += '<span style="position:relative;display:inline-block;' +
      (showTube ? 'width:' + tubeW + 'px;height:' + tubeH + 'px;' : 'padding:0 1px;') +
      'text-align:center;background:' + tubeBg + ';border:' + tubeBorder + ';' + tubeBorderBottom + tubeRadius + tubeBoxShadow + 'overflow:hidden">';

    /* Active digit with 5-layer glow */
    const digitPos = showTube ? 'position:absolute;left:50%;top:48%;transform:translate(-50%,-50%);' : 'position:relative;';
    const textGlow = '0 0 ' + Math.max(2,size*0.03) + 'px #FFFFFF, 0 0 ' + Math.max(8,size*0.1) + 'px #FFAA55, 0 0 ' + Math.max(16,size*0.22) + 'px #FF6600, 0 0 ' + Math.max(32,size*0.45) + 'px rgba(255,68,0,0.5), 0 0 ' + Math.max(60,size*0.8) + 'px rgba(255,0,0,0.2)';
    const flickerDur = (2.5 + Math.random() * 2).toFixed(1);
    const microDur = (0.8 + Math.random() * 0.5).toFixed(1);
    html += '<span style="' + digitPos + 'font-size:' + size + 'px;font-family:' + (isDigit ? NIXIE : "'IBM Plex Mono',monospace") + ';color:#FFAA55;text-shadow:' + textGlow + ';z-index:13;animation:nixieFlicker ' + flickerDur + 's ease-in-out infinite, nixieMicroFlicker ' + microDur + 's linear infinite">' + ch + '</span>';

    /* Glass reflections for showTube */
    if (showTube) {
      html += '<div style="position:absolute;top:8%;right:10%;width:45%;height:15%;background:linear-gradient(130deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02) 60%,transparent);border-radius:50%;transform:rotate(25deg);z-index:15;pointer-events:none"></div>';
    }
    html += '</span>';
  }
  html += '</span>';
  return html;
}

function bargraphBar(pct, label, color, flash) {
  const N = PANEL_SPEC.tubes || {};
  const MONO = "'IBM Plex Mono', monospace";
  const barColor = color || N.barStd || '#FF6622';
  const interior = N.interior || '#0C0A06';
  const glass = N.glass || '#332818';
  const cathode = N.cathode || '#1A1410';
  const svgW = 300;
  const h = 30;
  const barW = (Math.max(0, pct) / 100) * (svgW - 4);
  const fid = 'glow-' + label;

  const flashStyle = flash ? 'animation:blink 0.5s infinite;' : '';
  return '<div style="display:flex;align-items:center;gap:0.88cqw;' + flashStyle + '">' +
    '<span style="color:' + (N.label||'#AA8855') + ';text-shadow:0 0 2px ' + (N.label||'#AA8855') + '33;font-size:2.64cqw;font-family:' + MONO + ';width:4.10cqw;text-align:right;flex-shrink:0">' + label + '</span>' +
    '<svg width="100%" height="' + h + '" viewBox="0 0 ' + svgW + ' ' + h + '" preserveAspectRatio="none" style="overflow:visible;flex:1">' +
      '<defs>' +
        '<filter id="' + fid + '-w" x="-50%" y="-300%" width="200%" height="700%"><feGaussianBlur in="SourceGraphic" stdDeviation="8 4"/></filter>' +
        '<filter id="' + fid + '-m" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur in="SourceGraphic" stdDeviation="4 3"/></filter>' +
        '<filter id="' + fid + '-t" x="-10%" y="-100%" width="120%" height="300%"><feGaussianBlur in="SourceGraphic" stdDeviation="2 1.5"/></filter>' +
      '</defs>' +
      '<rect x="0" y="0" width="' + svgW + '" height="' + h + '" rx="11" ry="11" fill="' + interior + '" stroke="' + glass + '44" stroke-width="1"/>' +
      '<line x1="4" y1="' + (h/2) + '" x2="' + (svgW-4) + '" y2="' + (h/2) + '" stroke="' + cathode + '" stroke-width="0.5" opacity="0.35"/>' +
      '<rect x="2" y="' + (h/2-6) + '" width="' + Math.max(0,barW) + '" height="12" rx="6" ry="6" fill="' + barColor + '" opacity="0.5" filter="url(#' + fid + '-w)" style="transition:width 0.8s ease"/>' +
      '<rect x="2" y="' + (h/2-4) + '" width="' + Math.max(0,barW) + '" height="8" rx="4" ry="4" fill="' + barColor + '" opacity="0.7" filter="url(#' + fid + '-m)" style="transition:width 0.8s ease"/>' +
      '<rect x="2" y="' + (h/2-2) + '" width="' + Math.max(0,barW) + '" height="4" rx="2" ry="2" fill="#FFCC88" opacity="0.85" filter="url(#' + fid + '-t)" style="transition:width 0.8s ease"/>' +
      '<rect x="2" y="' + (h/2-0.75) + '" width="' + Math.max(0,barW) + '" height="1.5" rx="0.75" ry="0.75" fill="#FFDDAA" style="transition:width 0.8s ease"/>' +
    '</svg></div>';
}

function magicEye(pct, label, size) {
  const cx = 210, cy = 210, rOuter = 146, rInner = 66;
  const minAngle = 4, maxAngle = 320;
  const wedgeAngle = minAngle + (pct / 100) * (maxAngle - minAngle);
  const startDeg = -wedgeAngle / 2;
  const endDeg = wedgeAngle / 2;
  function polar(r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }
  function sector(rO, rI, s, e) {
    const span = ((e - s) % 360 + 360) % 360;
    const la = span > 180 ? 1 : 0;
    const p1 = polar(rO, s), p2 = polar(rO, e), p3 = polar(rI, e), p4 = polar(rI, s);
    return 'M ' + p1.x + ' ' + p1.y + ' A ' + rO + ' ' + rO + ' 0 ' + la + ' 1 ' + p2.x + ' ' + p2.y + ' L ' + p3.x + ' ' + p3.y + ' A ' + rI + ' ' + rI + ' 0 ' + la + ' 0 ' + p4.x + ' ' + p4.y + ' Z';
  }
  const shadowPath = sector(rOuter, rInner, startDeg, endDeg);
  const softPath = sector(rOuter + 4, rInner - 3, startDeg - 2.5, endDeg + 2.5);
  const s = size / 420;
  const holeSize = rInner * 2 * s;
  const MONO = "'IBM Plex Mono', monospace";
  const N = PANEL_SPEC.tubes || {};

  return '<div style="text-align:center">' +
    '<div style="color:' + (N.label||'#AA8855') + ';text-shadow:0 0 3px ' + (N.label||'#AA8855') + '44;font-size:2.34cqw;font-family:' + MONO + ';letter-spacing:3px;margin-bottom:3px">' + label + '</div>' +
    '<div style="position:relative;width:' + size + 'px;height:' + size + 'px;margin:0 auto;filter:drop-shadow(0 0 ' + (4*s) + 'px rgba(50,255,90,0.08)) drop-shadow(0 0 ' + (10*s) + 'px rgba(50,255,90,0.06))">' +
      '<svg viewBox="0 0 420 420" width="' + size + '" height="' + size + '" style="display:block">' +
        '<defs>' +
          '<filter id="og-' + label + '" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur in="SourceGraphic" stdDeviation="14" result="g1"/><feGaussianBlur in="SourceGraphic" stdDeviation="28" result="g2"/><feMerge><feMergeNode in="g2"/><feMergeNode in="g1"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
          '<filter id="sb-' + label + '" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4"/></filter>' +
          '<radialGradient id="ph-' + label + '" cx="50%" cy="47%" r="50%"><stop offset="0%" stop-color="#baff9f"/><stop offset="26%" stop-color="#7fff63" stop-opacity="0.98"/><stop offset="52%" stop-color="#46ef3f" stop-opacity="0.95"/><stop offset="78%" stop-color="#1fc62c" stop-opacity="0.92"/><stop offset="100%" stop-color="#0c7e1c" stop-opacity="0.90"/></radialGradient>' +
          '<radialGradient id="rf-' + label + '" cx="50%" cy="50%" r="58%"><stop offset="62%" stop-color="rgba(0,0,0,0)"/><stop offset="100%" stop-color="rgba(0,0,0,0.40)"/></radialGradient>' +
          '<clipPath id="fc-' + label + '"><circle cx="210" cy="210" r="146"/></clipPath>' +
          '<mask id="fm-' + label + '"><rect width="420" height="420" fill="black"/><circle cx="210" cy="210" r="146" fill="white"/><circle cx="210" cy="210" r="66" fill="black"/></mask>' +
        '</defs>' +
        '<circle cx="210" cy="210" r="132" fill="#31e13a" opacity="0.12" filter="url(#og-' + label + ')"/>' +
        '<g mask="url(#fm-' + label + ')">' +
          '<circle cx="210" cy="210" r="146" fill="url(#ph-' + label + ')" filter="url(#og-' + label + ')" opacity="0.78"/>' +
          '<circle cx="210" cy="210" r="146" fill="url(#ph-' + label + ')" opacity="0.92"/>' +
          '<path d="' + softPath + '" fill="rgba(0,0,0,0.34)" filter="url(#sb-' + label + ')" style="transition:d 0.5s ease"/>' +
          '<path d="' + shadowPath + '" fill="rgba(0,0,0,0.96)" style="transition:d 0.5s ease"/>' +
          '<circle cx="210" cy="210" r="146" fill="url(#rf-' + label + ')" opacity="0.95"/>' +
        '</g>' +
      '</svg>' +
      '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:' + holeSize + 'px;height:' + holeSize + 'px;border-radius:50%;background:radial-gradient(circle at 38% 30%,#141714 0%,#090a09 28%,#030303 72%,#000 100%);box-shadow:inset 0 1px 1px rgba(255,255,255,0.02),inset 0 -' + (5*s) + 'px ' + (10*s) + 'px rgba(0,0,0,0.92),0 0 0 1px rgba(255,255,255,0.02);display:grid;place-items:center">' +
        '<span style="color:#eefdeb;font-size:' + Math.max(11, holeSize*0.3) + 'px;font-weight:700;font-family:\'Nixie One\',cursive;line-height:1;text-shadow:0 0 4px rgba(140,255,160,0.10),0 0 8px rgba(140,255,160,0.05)">' + Math.round(pct) + '%</span>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function dekatron(rpm, size) {
  const N = PANEL_SPEC.tubes || {};
  const rps = rpm > 0 ? (rpm / 60) * 0.1 : 0;
  const speed = rps > 0 ? Math.max(0.3, 1 / rps) : 0;
  const stopped = !rpm || rpm <= 0;
  const dekOrange = N.dekOrange || '#FF6600';
  const dekGuide = N.dekGuide || '#552200';
  const dekInactive = '#181410';
  let html = '<div style="width:' + size + 'px;height:' + size + 'px;position:relative;' + (stopped ? 'opacity:0.3' : 'animation:spin ' + speed.toFixed(2) + 's linear infinite') + '">';
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const x = size / 2 + (size / 2 - 3) * Math.cos(angle) - 1.5;
    const y = size / 2 + (size / 2 - 3) * Math.sin(angle) - 1.5;
    const isActive = i === 0;
    const isTrail = i === 9;
    const dotColor = isActive ? dekOrange : isTrail ? dekGuide : dekInactive;
    const dotOpacity = isActive ? 1 : isTrail ? 0.4 : 0.15;
    const dotGlow = isActive ? '0 0 4px ' + dekOrange + ',0 0 10px ' + dekOrange + '66' : isTrail ? '0 0 3px ' + dekGuide : 'none';
    html += '<div style="position:absolute;left:' + x + 'px;top:' + y + 'px;width:3px;height:3px;border-radius:50%;background:' + dotColor + ';box-shadow:' + dotGlow + ';opacity:' + dotOpacity + '"></div>';
  }
  html += '</div>';
  return html;
}

function tubeSectionLabel(text, color, rightText, rightColor) {
  const N = PANEL_SPEC.tubes || {};
  const MONO = "'IBM Plex Mono', monospace";
  const rc = rightColor || color;
  return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.59cqw">' +
    '<span style="color:' + color + ';text-shadow:0 0 2px #FFFFFF66,0 0 6px ' + color + '88,0 0 14px ' + color + '44;font-size:1.95cqw;font-family:' + MONO + ';letter-spacing:3px">' + text + '</span>' +
    '<div style="flex:1;height:1px;background:' + color + '18;margin:0 1.17cqw"></div>' +
    (rightText ? '<span style="color:' + rc + ';text-shadow:0 0 2px #FFFFFF44,0 0 6px ' + rc + '66,0 0 12px ' + rc + '33;font-size:1.95cqw;font-family:' + MONO + ';letter-spacing:2px">' + rightText + '</span>' : '') +
  '</div>';
}

function tubeScreen1(c) {
  const N = PANEL_SPEC.tubes || {};
  const MONO = "'IBM Plex Mono', monospace";
  const bg = N.bg || '#0A0806';
  const core = N.core || '#FF8833';
  const warm = N.warm || '#FF9944';
  const eyeStd = N.eyeStd || '#22DD22';
  const label = N.label || '#AA8855';
  const cpuUsage = m('cpu.usage'), ramPct = m('mem.ram_percent');
  const diskRootPct = m('disk.root_percent');
  const diskHome = m('disk.home_used'), diskHomePct = m('disk.home_percent');
  const cpuTemp = m('cpu.temp'), mbTemp = m('cpu.mb_temp'), gpuTemp = m('gpu.temp');
  const ip = m('net.ip'), mac = m('net.mac'), netSpeed = m('net.speed');
  const dl = m('net.dl'), ul = m('net.ul');
  const llamaModel = m('llama.model'), tokSec = m('llama.tok_per_sec');
  const vramUsed = m('gpu.vram_used'), vramTotal = m('gpu.vram_total');
  const vramStr = vramUsed.available && vramTotal.available ? (vramUsed.value > 100 ? (vramUsed.value/1024).toFixed(1) : vramUsed.value) + '/' + (vramTotal.value > 100 ? Math.round(vramTotal.value/1024) : vramTotal.value) : '--';
  const speedStr = netSpeed.available ? (netSpeed.value >= 1000 ? Math.floor(netSpeed.value/1000) + ' GBPS' : netSpeed.value + ' MBPS') : '--';
  const hostname = m('sys.hostname');
  const hostStr = hostname.available ? esc(String(hostname.value).toUpperCase()) : '--';
  const temps = [cpuTemp.available?cpuTemp.value:0, mbTemp.available?mbTemp.value:0, gpuTemp.available?gpuTemp.value:0];
  const anyDanger = temps.some(t => t >= 110);
  const anyOrange = temps.some(t => t >= 90);
  const thermalStatus = anyDanger ? 'CRITICAL' : anyOrange ? 'WARNING' : 'NOMINAL';
  const thermalStatusColor = anyDanger ? '#FF3322' : anyOrange ? core : eyeStd;
  const secPct = diskHome.available && diskHomePct.available ? diskHomePct.value : 0;
  function tempColor(t) { if (t >= 90) return '#FF3322'; if (t >= 70) return '#DDCC00'; if (t >= 50) return eyeStd; return '#4488DD'; }
  function tempFlash(t) { return t >= 100 ? ';animation:blink 0.5s infinite' : ''; }
  function tempPct(t) { return Math.max(0, Math.min(100, ((Math.max(20, Math.min(120, t)) - 20) / 100) * 100)); }
  return '<div class="screen-frame"><div style="background:' + bg + ';width:100%;height:100%;padding:0.88cqw;display:flex;flex-direction:column;gap:0.59cqw">' +
    '<div style="display:flex;gap:1.17cqw">' +
      '<div style="flex:1">' + tubeSectionLabel('CORE SYSTEMS', core, hostStr, warm) + '</div>' +
      '<div style="flex:1">' + tubeSectionLabel('THERMALS', warm, thermalStatus, thermalStatusColor) + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:1.17cqw;flex:1">' +
      '<div style="flex:1;display:flex;justify-content:space-around;align-items:center">' +
        magicEye(cpuUsage.available?cpuUsage.value:0, 'CPU', 180) +
        magicEye(ramPct.available?ramPct.value:0, 'RAM', 180) +
        magicEye(diskRootPct.available?diskRootPct.value:0, 'SSD', 180) +
      '</div>' +
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:0.88cqw">' +
        bargraphBar(tempPct(cpuTemp.available?cpuTemp.value:20), 'CPU', tempColor(cpuTemp.available?cpuTemp.value:20), (cpuTemp.available?cpuTemp.value:0)>=100) +
        bargraphBar(tempPct(mbTemp.available?mbTemp.value:20), 'MB', tempColor(mbTemp.available?mbTemp.value:20), (mbTemp.available?mbTemp.value:0)>=100) +
        bargraphBar(tempPct(gpuTemp.available?gpuTemp.value:20), 'GPU', tempColor(gpuTemp.available?gpuTemp.value:20), (gpuTemp.available?gpuTemp.value:0)>=100) +
        '<div style="margin-left:4.10cqw;position:relative;height:2.34cqw"><div style="position:absolute;top:0;left:0;right:0;height:1px;background:' + core + '33"></div>' +
          [20,50,70,90,110,120].map(function(t) { return '<div style="position:absolute;left:' + (((t-20)/100)*100) + '%;top:0;transform:translateX(-50%)"><div style="width:1px;height:0.88cqw;background:' + core + '66"></div><div style="color:' + core + ';text-shadow:0 0 3px ' + core + '55;font-size:1.46cqw;font-family:' + MONO + ';text-align:center;margin-top:1px">' + t + '</div></div>'; }).join('') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:1.17cqw;align-items:center">' +
      '<div style="flex:1">' +
        (diskHome.available ?
          '<div style="position:relative;height:2.93cqw;background:#0C0A06;border:1px solid #33281844;border-radius:10px;overflow:hidden">' +
            '<div style="position:absolute;top:0;left:0;right:0;height:100%;display:flex;justify-content:space-between;align-items:center;padding:0 1.46cqw;font-family:' + MONO + ';font-size:1.46cqw;color:#CCDDFF;text-shadow:0 0 2px #4488DD88;z-index:2;pointer-events:none"><span>SECONDARY</span><span>' + fmtCapacity(diskHome) + ' / ' + fmtCapacityTotal(diskHome) + '</span></div>' +
          '</div>' :
          '<div style="height:2.93cqw;background:#0C0A06;border-radius:10px;display:flex;align-items:center;justify-content:center;font-family:' + MONO + ';font-size:1.46cqw;color:' + (N.barDim||'#CC4400') + '">SECONDARY \u2014 NONE</div>') +
      '</div>' +
      '<div style="flex:1;display:flex;justify-content:center;align-items:center;gap:0.88cqw">' +
        (function() {
          var cpuF = m('cpu.fans_cpu'), caseF = m('cpu.fans_case'), gpuFan = m('gpu.fan'), h = '';
          var cpuList = asList(cpuF), caseList = asList(caseF);
          if (cpuList.length) {
            h += '<span style="color:' + label + ';font-size:1.76cqw;font-family:' + MONO + '">CPU</span>';
            for (var i = 0; i < cpuList.length; i++) h += dekatron(cpuList[i], 24);
          }
          if (caseList.length) {
            h += '<span style="color:' + label + ';font-size:1.76cqw;font-family:' + MONO + '">CASE</span>';
            for (var i = 0; i < caseList.length; i++) h += dekatron(caseList[i], 24);
          }
          if (gpuFan.available) {
            h += '<span style="color:' + label + ';font-size:1.76cqw;font-family:' + MONO + '">GPU</span>';
            h += dekatron(gpuFan.value * 10, 24);
          }
          if (!h) h = '<span style="color:' + label + ';font-size:1.76cqw;font-family:' + MONO + ';opacity:0.4">NO FANS</span>';
          return h;
        })() +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:1.17cqw">' +
      '<div style="flex:1">' + tubeSectionLabel('COMMS', '#4488DD', speedStr) + '</div>' +
      '<div style="flex:1">' + tubeSectionLabel('NPU', warm, backendTitle()) + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:1.17cqw;flex:1">' +
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between">' +
        '<div style="display:flex;flex-direction:column;gap:0.29cqw">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline"><span style="color:' + label + ';font-size:2.64cqw;font-family:' + MONO + '">IP</span>' + nixieDigit(ip.available?esc(String(ip.value)):'N/A', 32) + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline"><span style="color:' + label + ';font-size:2.64cqw;font-family:' + MONO + '">MAC</span>' + nixieDigit(mac.available?esc(String(mac.value)):'N/A', 32) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:1.76cqw;align-items:center">' +
          '<div style="display:flex;align-items:center;gap:0.59cqw"><span style="color:' + eyeStd + ';text-shadow:0 0 4px ' + eyeStd + '88;font-size:1.76cqw;font-family:' + MONO + '">\u25B2</span>' + nixieDigit((ul.available?ul.value:'0'), 32) + '<span style="color:' + label + ';font-size:1.76cqw;font-family:' + MONO + '">' + (ul.available?ul.unit:'B/s') + '</span></div>' +
          '<div style="display:flex;align-items:center;gap:0.59cqw"><span style="color:#4488DD;text-shadow:0 0 4px #4488DD88;font-size:1.76cqw;font-family:' + MONO + '">\u25BC</span>' + nixieDigit((dl.available?dl.value:'0'), 32) + '<span style="color:' + label + ';font-size:1.76cqw;font-family:' + MONO + '">' + (dl.available?dl.unit:'B/s') + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between">' +
        '<div style="display:flex;flex-direction:column;gap:0.29cqw">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline"><span style="color:' + label + ';font-size:2.64cqw;font-family:' + MONO + '">MODEL</span>' + nixieDigit(cleanModel(), 26) + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline"><span style="color:' + label + ';font-size:2.64cqw;font-family:' + MONO + '">QUANT</span>' + nixieDigit(mv('llama.quant'), 26) + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline"><span style="color:' + label + ';font-size:2.64cqw;font-family:' + MONO + '">CTX</span>' + nixieDigit(mv('llama.context'), 26) + '</div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
          '<div style="display:flex;align-items:baseline;gap:0.59cqw"><span style="color:' + label + ';font-size:2.64cqw;font-family:' + MONO + '">T/S</span>' + nixieDigit(tokSec.available?Math.round(tokSec.value):'--', 38) + '</div>' +
          '<div style="display:flex;align-items:baseline;gap:0.59cqw"><span style="color:' + label + ';font-size:2.64cqw;font-family:' + MONO + '">VRAM</span>' + nixieDigit(vramStr, 38) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div></div>';
}

function tubeScreen2(c) {
  const N = PANEL_SPEC.tubes || {};
  const NIXIE = "'Nixie One', cursive";
  const MONO = "'IBM Plex Mono', monospace";
  const bg = N.bg || '#0A0806';
  const barDim = N.barDim || '#CC4400';
  const core = N.core || '#FF8833';
  const dekOrange = N.dekOrange || '#FF6600';
  const warm = N.warm || '#FF9944';
  const eyeStd = N.eyeStd || '#22DD22';
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const dayName = days[now.getDay()];
  const dateStr = months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();

  return '<div class="screen-frame"><div style="background:' + bg + ';width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:' + MONO + '">' +
    '<div style="color:' + barDim + ';text-shadow:0 0 3px ' + barDim + '44;font-size:1.76cqw;letter-spacing:8px;margin-bottom:2.05cqw">NIXIE TUBE CHRONOMETER</div>' +
    '<div style="display:flex;align-items:center;gap:5px">' +
      nixieDigit(hh[0], 125, true) +
      nixieDigit(hh[1], 125, true) +
      '<span style="color:#FFAA55;font-size:11.72cqw;font-family:' + NIXIE + ';text-shadow:0 0 3px #fff,0 0 8px #FFAA55,0 0 16px #FF6600,0 0 32px #FF4400AA,0 0 50px #FF000044;animation:blink 1s infinite;margin:0 3px">:</span>' +
      nixieDigit(mm[0], 125, true) +
      nixieDigit(mm[1], 125, true) +
      '<div style="width:12px"></div>' +
      nixieDigit(ss[0], 70, true) +
      nixieDigit(ss[1], 70, true) +
    '</div>' +
    '<div style="color:#FFAA55;text-shadow:0 0 3px #fff,0 0 8px #FFAA55,0 0 18px #FF660066,0 0 35px #FF440033;font-size:4.69cqw;font-family:' + NIXIE + ';letter-spacing:8px;margin-top:2.05cqw">' + dayName + '</div>' +
    '<div style="color:#FFAA55;text-shadow:0 0 3px #fff,0 0 8px #FFAA55,0 0 18px #FF660066,0 0 35px #FF440033;font-size:5.27cqw;font-family:' + NIXIE + ';letter-spacing:4px;margin-top:0.59cqw">' + dateStr + '</div>' +
    '<div style="display:flex;align-items:center;gap:1.46cqw;margin-top:2.34cqw">' +
      [dekOrange, warm, eyeStd, '#8855DD', eyeStd, warm, dekOrange].map(function(c) { return '<div style="width:0.73cqw;height:0.73cqw;border-radius:50%;background:' + c + ';box-shadow:0 0 4px ' + c + ',0 0 8px ' + c + '66,0 0 14px ' + c + '22;opacity:0.7"></div>'; }).join('') +
    '</div>' +
  '</div></div>';
}

/* ═══════════════════════════════════════
   VINTAGE / VFD (Seven-Segment Redux)
   ═══════════════════════════════════════ */

function vfdPal(colorName) {
  const V = PANEL_SPEC.vfd || {};
  return {
    main: V[colorName] || '#00DDAA',
    bright: V[colorName+'Bright'] || '#44FFCC',
    dim: V[colorName+'Dim'] || '#008866',
    ghost: V[colorName+'Ghost'] || V.ghost || '#0A1A15',
  };
}

function vfdSectionLabel(text, color, rightText, rightColor) {
  const p = vfdPal(color);
  const rp = rightColor ? vfdPal(rightColor) : p;
  const F = "'Share Tech Mono', monospace";
  return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.59cqw">' +
    '<span style="color:' + p.main + ';text-shadow:0 0 4px ' + p.dim + ';font-size:2.34cqw;font-family:' + F + ';letter-spacing:3px">' + text + '</span>' +
    '<div style="flex:1;height:1px;background:' + p.main + '18;margin:0 1.17cqw"></div>' +
    (rightText ? '<span style="color:' + rp.main + ';text-shadow:0 0 3px ' + rp.dim + ';font-size:1.76cqw;font-family:' + F + ';letter-spacing:2px">' + rightText + '</span>' : '') +
  '</div>';
}

function vfdDonut(pct, label, color, size) {
  const p = vfdPal(color);
  const V = PANEL_SPEC.vfd || {};
  const F = "'Share Tech Mono', monospace";
  const cx = size / 2, cy = size / 2;
  const r = (size - 14) / 2;
  const sw = size * 0.08;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const isHigh = pct > 80;
  const ac = isHigh ? (V.red || '#FF4433') : p.main;
  const ab = isHigh ? (V.redBright || '#FF7766') : p.bright;
  const fid = 'dn-' + label;

  let ticks = '';
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + (r - sw/2 - 1) * Math.cos(a), y1 = cy + (r - sw/2 - 1) * Math.sin(a);
    const x2 = cx + (r + sw/2 + 1) * Math.cos(a), y2 = cy + (r + sw/2 + 1) * Math.sin(a);
    ticks += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + (V.substrate||'#0A0A08') + '" stroke-width="1"/>';
  }

  return '<div style="text-align:center">' +
    '<div style="color:' + p.main + ';text-shadow:0 0 4px ' + p.dim + ';font-size:2.20cqw;font-family:' + F + ';letter-spacing:3px;margin-bottom:3px">' + label + '</div>' +
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="display:block;overflow:visible">' +
      '<defs><filter id="' + fid + '-b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="g1"/><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="g2"/><feMerge><feMergeNode in="g2"/><feMergeNode in="g1"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + p.ghost + '" stroke-width="' + sw + '"/>' +
      ticks +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + ac + '" stroke-width="' + sw + '" stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" stroke-linecap="butt" transform="rotate(-90 ' + cx + ' ' + cy + ')" opacity="0.5" filter="url(#' + fid + '-b)" style="transition:stroke-dashoffset 0.8s ease,stroke 0.5s ease"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + ac + '" stroke-width="' + sw + '" stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" stroke-linecap="butt" transform="rotate(-90 ' + cx + ' ' + cy + ')" opacity="0.95" style="transition:stroke-dashoffset 0.8s ease,stroke 0.5s ease"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + ab + '" stroke-width="' + (sw*0.5) + '" stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" stroke-linecap="butt" transform="rotate(-90 ' + cx + ' ' + cy + ')" opacity="0.3" style="transition:stroke-dashoffset 0.8s ease,stroke 0.5s ease"/>' +
      '<text x="' + cx + '" y="' + (cy+1) + '" text-anchor="middle" dominant-baseline="central" fill="' + ac + '" font-size="' + (size*0.22) + '" font-family="' + F + '" style="filter:drop-shadow(0 0 3px ' + ac + '88)">' + Math.round(pct) + '%</text>' +
    '</svg></div>';
}

function vfdThermalBar(temp, label) {
  const V = PANEL_SPEC.vfd || {};
  const F = "'Share Tech Mono', monospace";
  const pct = ((Math.max(20, Math.min(120, temp)) - 20) / 100) * 100;
  let color = 'blue';
  if (temp >= 90) color = 'red';
  else if (temp >= 70) color = 'yellow';
  else if (temp >= 50) color = 'green';
  const vfdFlash = temp >= 100 ? 'animation:blink 0.5s infinite;' : '';
  const p = vfdPal(color);
  const totalSegs = 16;
  const litSegs = Math.round((pct / 100) * totalSegs);
  const fid = 'tb-' + label;
  const ghost = V.ghost || '#0A1A15';

  let segs = '<defs><filter id="' + fid + '" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.2 0.8"/></filter></defs>';
  for (let i = 0; i < totalSegs; i++) {
    const x = i * (160 / totalSegs) + 0.5;
    const w = (160 / totalSegs) - 1.5;
    segs += '<rect x="' + x + '" y="1" width="' + w + '" height="22" rx="1" fill="' + ghost + '" stroke="' + ghost + '66" stroke-width="0.3"/>';
  }
  for (let i = 0; i < litSegs; i++) {
    const x = i * (160 / totalSegs) + 0.5;
    const w = (160 / totalSegs) - 1.5;
    segs += '<rect x="' + x + '" y="1" width="' + w + '" height="22" rx="1" fill="' + p.main + '" opacity="0.5" filter="url(#' + fid + ')"/>';
    segs += '<rect x="' + x + '" y="1" width="' + w + '" height="22" rx="1" fill="' + p.main + '" opacity="0.9"/>';
    segs += '<rect x="' + x + '" y="3" width="' + w + '" height="16" rx="0.5" fill="' + p.bright + '" opacity="0.25"/>';
  }

  return '<div style="display:flex;align-items:center;gap:0.88cqw;' + vfdFlash + '">' +
    '<span style="color:' + (V.green||'#00DDAA') + ';text-shadow:0 0 3px ' + (V.greenDim||'#008866') + ';font-size:2.20cqw;font-family:' + F + ';width:4.69cqw;text-align:right;flex-shrink:0">' + label + '</span>' +
    '<svg width="100%" height="24" viewBox="0 0 160 24" preserveAspectRatio="none" style="flex:1;overflow:visible">' + segs + '</svg></div>';
}

function vfdPanel(children) {
  const V = PANEL_SPEC.vfd || {};
  const filament = V.filament || '#332211';
  const filamentWarm = V.filamentWarm || '#443322';
  const grid = V.grid || '#1A1A18';
  const substrate = V.substrate || '#0A0A08';
  return '<div style="background:' + substrate + ';border:1px solid #1a1a16;border-radius:3px;position:relative;overflow:hidden;box-shadow:inset 0 0 20px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.02),0 2px 8px rgba(0,0,0,0.6);width:100%;height:100%">' +
    '<div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:20;background-image:linear-gradient(0deg,transparent 0px,transparent 11px,' + filamentWarm + '18 11px,' + filamentWarm + '18 12px,transparent 12px,transparent 23px,' + filament + '12 23px,' + filament + '12 24px,transparent 24px);background-size:100% 24px"></div>' +
    '<div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:21;opacity:0.06;background-image:linear-gradient(0deg,' + grid + ' 1px,transparent 1px),linear-gradient(90deg,' + grid + ' 1px,transparent 1px);background-size:4px 4px"></div>' +
    '<div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:22;background:radial-gradient(ellipse at 50% 40%,transparent 50%,rgba(0,0,0,0.15) 100%)"></div>' +
    children +
  '</div>';
}

function vfdScreen1(c) {
  const V = PANEL_SPEC.vfd || {};
  const F = "'Share Tech Mono', monospace";
  const cpuUsage = m('cpu.usage'), ramPct = m('mem.ram_percent');
  const diskRootPct = m('disk.root_percent');
  const diskHome = m('disk.home_used'), diskHomePct = m('disk.home_percent');
  const cpuTemp = m('cpu.temp'), mbTemp = m('cpu.mb_temp'), gpuTemp = m('gpu.temp');
  const ip = m('net.ip'), mac = m('net.mac'), netSpeed = m('net.speed');
  const dl = m('net.dl'), ul = m('net.ul');
  const llamaModel = m('llama.model'), tokSec = m('llama.tok_per_sec');
  const vramUsed = m('gpu.vram_used'), vramTotal = m('gpu.vram_total');
  const vramStr = vramUsed.available && vramTotal.available ? (vramUsed.value > 100 ? (vramUsed.value/1024).toFixed(1) : vramUsed.value) + '/' + (vramTotal.value > 100 ? Math.round(vramTotal.value/1024) : vramTotal.value) : '--';
  const speedStr = netSpeed.available ? (netSpeed.value >= 1000 ? Math.floor(netSpeed.value/1000) + ' GBPS' : netSpeed.value + ' MBPS') : '--';
  const hostname = m('sys.hostname');
  const hostStr = hostname.available ? esc(String(hostname.value).toUpperCase()) : '--';
  const temps = [cpuTemp.available?cpuTemp.value:0, mbTemp.available?mbTemp.value:0, gpuTemp.available?gpuTemp.value:0];
  const anyDanger = temps.some(t => t >= 110);
  const anyWarn = temps.some(t => t >= 90);
  const thermalStatus = anyDanger ? 'CRITICAL' : anyWarn ? 'WARNING' : 'NOMINAL';
  const statusColor = anyDanger ? 'red' : anyWarn ? 'amber' : 'green';
  const secPct = diskHome.available && diskHomePct.available ? diskHomePct.value : 0;
  const green = V.green || '#00DDAA';
  const greenDim = V.greenDim || '#008866';
  const blue = V.blue || '#00D4CC';
  const blueDim = V.blueDim || '#007A77';

  const content = '<div style="width:100%;height:100%;padding:1.17cqw;display:flex;flex-direction:column;gap:0.59cqw;position:relative;z-index:10">' +
    '<div style="display:flex;gap:1.17cqw">' +
      '<div style="flex:1">' + vfdSectionLabel('CORE SYSTEMS', 'green', hostStr, 'amber') + '</div>' +
      '<div style="flex:1">' + vfdSectionLabel('THERMALS', 'amber', thermalStatus, statusColor) + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:1.46cqw;flex:1">' +
      '<div style="flex:1;display:flex;justify-content:space-around;align-items:center">' +
        vfdDonut(cpuUsage.available?cpuUsage.value:0, 'CPU', 'green', 160) +
        vfdDonut(ramPct.available?ramPct.value:0, 'RAM', 'blue', 160) +
        vfdDonut(diskRootPct.available?diskRootPct.value:0, 'SSD', 'amber', 160) +
      '</div>' +
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:1.17cqw">' +
        vfdThermalBar(cpuTemp.available?cpuTemp.value:20, 'CPU') +
        vfdThermalBar(mbTemp.available?mbTemp.value:20, 'MB') +
        vfdThermalBar(gpuTemp.available?gpuTemp.value:20, 'GPU') +
        '<div style="margin-left:4.69cqw;position:relative;height:2.93cqw"><div style="position:absolute;top:0;left:0;right:0;height:1px;background:' + green + '22"></div>' +
          [20,50,70,90,110,120].map(function(t) { return '<div style="position:absolute;left:' + (((t-20)/100)*100) + '%;top:0;transform:translateX(-50%)"><div style="width:1px;height:0.73cqw;background:' + green + '44"></div><div style="color:' + green + ';text-shadow:0 0 2px ' + greenDim + ';font-size:1.95cqw;font-family:' + F + ';text-align:center;margin-top:1px">' + t + '</div></div>'; }).join('') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:1.17cqw;align-items:center">' +
      '<div style="flex:1">' +
        (diskHome.available ?
          '<div style="display:flex;align-items:center;gap:0.59cqw">' +
            '<span style="color:' + blue + ';text-shadow:0 0 3px ' + blueDim + ';font-size:1.46cqw;font-family:' + F + ';flex-shrink:0">SEC</span>' +
            '<div style="flex:1;height:3.22cqw;background:' + (V.blueGhost||'#0A1018') + ';border-radius:1px;overflow:hidden;position:relative">' +
              '<div style="position:absolute;top:0;left:0;height:100%;width:' + secPct + '%;background:' + blue + ';border-radius:1px;transition:width 0.8s ease;box-shadow:0 0 4px ' + blue + '66"></div>' +
            '</div>' +
            '<span style="color:' + blue + ';text-shadow:0 0 3px ' + blueDim + ';font-size:1.46cqw;font-family:' + F + ';flex-shrink:0">' + fmtCapacity(diskHome) + '/' + fmtCapacityTotal(diskHome) + '</span>' +
          '</div>' :
          '<span style="color:' + (V.ghost||'#0A1A15') + ';font-size:1.76cqw;font-family:' + F + '">SECONDARY \u2014 NONE</span>') +
      '</div>' +
      '<div style="flex:1;display:flex;justify-content:center;align-items:center;gap:0.88cqw">' +
        (function() {
          var cpuF = m('cpu.fans_cpu'), caseF = m('cpu.fans_case'), gpuFan = m('gpu.fan'), h = '';
          var cpuList = asList(cpuF), caseList = asList(caseF);
          if (cpuList.length) {
            h += '<span style="color:' + greenDim + ';text-shadow:0 0 2px ' + greenDim + '44;font-size:1.76cqw;font-family:' + F + '">CPU</span>';
            for (var i = 0; i < cpuList.length; i++) h += fanIcon(green, '2.93cqw', cpuList[i]);
          }
          if (caseList.length) {
            h += '<span style="color:' + greenDim + ';text-shadow:0 0 2px ' + greenDim + '44;font-size:1.76cqw;font-family:' + F + '">CASE</span>';
            for (var i = 0; i < caseList.length; i++) h += fanIcon(green, '2.93cqw', caseList[i]);
          }
          if (gpuFan.available) {
            h += '<span style="color:' + greenDim + ';text-shadow:0 0 2px ' + greenDim + '44;font-size:1.76cqw;font-family:' + F + '">GPU</span>';
            h += fanIcon(green, '2.93cqw', gpuFan.value * 10);
          }
          if (!h) h = '<span style="color:' + greenDim + ';font-size:1.76cqw;font-family:' + F + ';opacity:0.4">NO FANS</span>';
          return h;
        })() +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:1.17cqw">' +
      '<div style="flex:1">' + vfdSectionLabel('COMMS', 'blue', speedStr) + '</div>' +
      '<div style="flex:1">' + vfdSectionLabel('NPU', 'amber', backendTitle()) + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:1.46cqw;flex:1">' +
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between">' +
        '<div style="display:flex;flex-direction:column;gap:0.29cqw">' +
          '<div style="display:flex;justify-content:space-between"><span style="color:' + greenDim + ';font-size:2.05cqw;font-family:' + F + '">IP</span><span style="color:' + green + ';text-shadow:0 0 4px ' + green + '66;font-size:3.52cqw;font-family:' + F + '">' + (ip.available?esc(String(ip.value)):'N/A') + '</span></div>' +
          '<div style="display:flex;justify-content:space-between"><span style="color:' + greenDim + ';font-size:2.05cqw;font-family:' + F + '">MAC</span><span style="color:' + green + ';text-shadow:0 0 4px ' + green + '66;font-size:3.52cqw;font-family:' + F + '">' + (mac.available?esc(String(mac.value)):'N/A') + '</span></div>' +
        '</div>' +
        '<div style="display:flex;gap:1.76cqw;align-items:center">' +
          '<div style="display:flex;align-items:center;gap:0.59cqw"><span style="color:' + green + ';text-shadow:0 0 4px ' + greenDim + ';font-size:1.76cqw;font-family:' + F + '">\u25B2</span><span style="color:' + green + ';text-shadow:0 0 4px ' + green + '66;font-size:4.10cqw;font-family:' + F + '">' + (ul.available?ul.value:'0') + '</span><span style="color:' + greenDim + ';font-size:1.76cqw;font-family:' + F + '">' + (ul.available?ul.unit:'B/s') + '</span></div>' +
          '<div style="display:flex;align-items:center;gap:0.59cqw"><span style="color:' + blue + ';text-shadow:0 0 4px ' + blueDim + ';font-size:1.76cqw;font-family:' + F + '">\u25BC</span><span style="color:' + blue + ';text-shadow:0 0 4px ' + blue + '66;font-size:4.10cqw;font-family:' + F + '">' + (dl.available?dl.value:'0') + '</span><span style="color:' + blueDim + ';font-size:1.76cqw;font-family:' + F + '">' + (dl.available?dl.unit:'B/s') + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between">' +
        '<div style="display:flex;flex-direction:column;gap:0.29cqw">' +
          '<div style="display:flex;justify-content:space-between"><span style="color:' + (V.amberDim||'#886611') + ';font-size:2.05cqw;font-family:' + F + '">MODEL</span><span style="color:' + (V.amber||'#FFAA22') + ';text-shadow:0 0 4px ' + (V.amber||'#FFAA22') + '66;font-size:3.81cqw;font-family:' + F + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right">' + cleanModel() + '</span></div>' +
          '<div style="display:flex;justify-content:space-between"><span style="color:' + (V.amberDim||'#886611') + ';font-size:2.05cqw;font-family:' + F + '">QUANT</span><span style="color:' + (V.amber||'#FFAA22') + ';text-shadow:0 0 4px ' + (V.amber||'#FFAA22') + '66;font-size:3.81cqw;font-family:' + F + '">' + mv('llama.quant') + '</span></div>' +
          '<div style="display:flex;justify-content:space-between"><span style="color:' + (V.amberDim||'#886611') + ';font-size:2.05cqw;font-family:' + F + '">CTX</span><span style="color:' + (V.amber||'#FFAA22') + ';text-shadow:0 0 4px ' + (V.amber||'#FFAA22') + '66;font-size:3.81cqw;font-family:' + F + '">' + mv('llama.context') + '</span></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
          '<div><span style="color:' + greenDim + ';font-size:1.95cqw;font-family:' + F + '">T/S</span> <span style="color:' + green + ';text-shadow:0 0 5px ' + green + '66;font-size:4.39cqw;font-family:' + F + '">' + (tokSec.available?Math.round(tokSec.value):'--') + '</span></div>' +
          '<div><span style="color:' + blueDim + ';font-size:1.95cqw;font-family:' + F + '">VRAM</span> <span style="color:' + blue + ';text-shadow:0 0 5px ' + blue + '66;font-size:4.39cqw;font-family:' + F + '">' + vramStr + '</span></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  return '<div class="screen-frame">' + vfdPanel(content) + '</div>';
}

function vfdScreen2(c) {
  const V = PANEL_SPEC.vfd || {};
  const F = "'Share Tech Mono', monospace";
  const green = V.green || '#00DDAA';
  const greenDim = V.greenDim || '#008866';
  const amber = V.amber || '#FFAA22';
  const amberDim = V.amberDim || '#886611';
  const blue = V.blue || '#00D4CC';
  const blueDim = V.blueDim || '#007A77';
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const dateStr = now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();

  const hostname = m('sys.hostname');
  const hostStr = hostname.available ? esc(String(hostname.value).toUpperCase()) : '--';
  const content = '<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:1.76cqw;position:relative;z-index:10">' +
    '<div style="color:' + greenDim + ';text-shadow:0 0 3px ' + greenDim + '44;font-size:2.64cqw;font-family:' + F + ';letter-spacing:8px">VFD CHRONOMETER</div>' +
    '<div style="width:85%;height:1px;background:linear-gradient(90deg,transparent,' + green + '33,' + amber + '33,' + blue + '33,transparent)"></div>' +
    '<div style="display:flex;align-items:baseline">' +
      '<span style="color:' + green + ';text-shadow:0 0 4px ' + greenDim + ',0 0 10px ' + green + '44;font-size:21.48cqw;font-family:' + F + '">' + hh + '</span>' +
      '<span style="color:' + green + ';text-shadow:0 0 4px ' + greenDim + ';font-size:14.65cqw;animation:blink 1s infinite;margin:0 0.59cqw">:</span>' +
      '<span style="color:' + green + ';text-shadow:0 0 4px ' + greenDim + ',0 0 10px ' + green + '44;font-size:21.48cqw;font-family:' + F + '">' + mm + '</span>' +
      '<span style="color:' + amber + ';text-shadow:0 0 4px ' + amberDim + ',0 0 8px ' + amber + '44;font-size:9.77cqw;font-family:' + F + ';margin-left:1.76cqw">' + ss + '</span>' +
    '</div>' +
    '<div style="color:' + amber + ';text-shadow:0 0 5px ' + amberDim + ';font-size:5.86cqw;font-family:' + F + ';letter-spacing:8px">' + days[now.getDay()] + '</div>' +
    '<div style="color:' + blue + ';text-shadow:0 0 5px ' + blueDim + ';font-size:5.57cqw;font-family:' + F + ';letter-spacing:4px">' + dateStr + '</div>' +
    '<div style="width:85%;height:1px;background:linear-gradient(90deg,transparent,' + blue + '33,' + amber + '33,' + green + '33,transparent)"></div>' +
    '<div style="color:' + greenDim + ';text-shadow:0 0 3px ' + greenDim + '44;font-size:1.76cqw;font-family:' + F + ';letter-spacing:6px">' + hostStr + ' \u2022 VACUUM FLUORESCENT DISPLAY</div>' +
  '</div>';

  return '<div class="screen-frame">' + vfdPanel(content) + '</div>';
}

/* ═══ Screen 3 — Claude Usage (shared, adapts to theme) ═══ */

/* Safe thousands-separated integer. A metric flagged available is not a
   promise that it carries a number, so never call .toLocaleString() blind. */
function fmtNum(d, fallback) {
  if (!d || !d.available || d.value == null || isNaN(d.value)) {
    return fallback === undefined ? '--' : fallback;
  }
  return Number(d.value).toLocaleString();
}

function fmtTok(n) {
  if (n == null || isNaN(n) || n === 0) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function sparkline(samples, color, w, h) {
  if (!samples || samples.length < 2) {
    const emptyPts = Array.from({length: 30}, (_, i) => `${(i/29)*w},${h}`).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${emptyPts}" fill="none" stroke="${color}" stroke-width="1" opacity="0.2"/></svg>`;
  }
  const max = Math.max(1, ...samples);
  const pts = samples.map((v, i) => {
    const x = (i / (samples.length - 1)) * w;
    const y = h - (v / max) * (h - 2);
    return `${x},${y}`;
  }).join(' ');
  const fillPts = pts + ` ${w},${h} 0,${h}`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<polygon points="${fillPts}" fill="${color}" opacity="0.15"/>` +
    `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

function claudeScreen3(c) {
  const pri = c.primary || '#00ff41';
  const acc = c.accent || '#ffb000';
  const dim = c.dim || c.border || '#333';
  const hdr = c.header || pri;
  const crit = c.critical || '#ff3333';
  const bg = c.panel || 'rgba(0,0,0,0.3)';
  const font = c.font || 'monospace';
  // Token type colors derived from theme
  const cIn = pri, cOut = acc, cCW = hdr, cCR = crit;

  const tokIn = m('claude.tokens_input');
  const tokOut = m('claude.tokens_output');
  const tokCW = m('claude.tokens_cache_write');
  const tokCR = m('claude.tokens_cache_read');
  const tokTotal = m('claude.tokens_total');

  const sessIn = m('claude.session_input');
  const sessOut = m('claude.session_output');
  const sessCW = m('claude.session_cache_write');
  const sessCR = m('claude.session_cache_read');
  const sessTotal = m('claude.session_total');
  const sessMsgs = m('claude.session_msgs');

  const msgsUser = m('claude.msgs_user');
  const msgsAsst = m('claude.msgs_assistant');
  const msgsTotal = m('claude.msgs_total');
  const monthlyTok = m('claude.monthly_tokens');
  const monthlyMsg = m('claude.monthly_messages');
  const days = m('claude.days_active');
  const sessions = m('claude.sessions');
  const agents = m('claude.agents_active');
  const rate = m('claude.token_rate');
  const spark = m('claude.sparkline');

  // Token breakdown bar
  function tokBar(input, output, cw, cr, total) {
    if (!total || total === 0) return `<div style="height:6px;background:${dim};border-radius:3px"></div>`;
    const t = total;
    const pI = (input / t) * 100;
    const pO = (output / t) * 100;
    const pW = (cw / t) * 100;
    const pR = (cr / t) * 100;
    return `<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;background:${dim}">` +
      `<div style="width:${pI}%;background:${cIn}" title="Input"></div>` +
      `<div style="width:${pO}%;background:${cOut}" title="Output"></div>` +
      `<div style="width:${pW}%;background:${cCW}" title="Cache Write"></div>` +
      `<div style="width:${pR}%;background:${cCR}" title="Cache Read"></div>` +
    `</div>`;
  }

  function statRow(label, val, color) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:1px 0">` +
      `<span style="color:${dim};font-size:1.56cqw">${label}</span>` +
      `<span style="color:${color || pri};font-size:1.76cqw;font-weight:600">${val}</span></div>`;
  }

  function sectionTitle(text) {
    return `<div style="color:${hdr};font-size:1.66cqw;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px;border-bottom:1px solid ${dim};padding-bottom:2px">${text}</div>`;
  }

  // Legend for token types
  const legend = `<div style="display:flex;gap:8px;margin-top:4px;font-size:1.27cqw">` +
    `<span style="color:${cIn}">\u25A0 Input</span>` +
    `<span style="color:${cOut}">\u25A0 Output</span>` +
    `<span style="color:${cCW}">\u25A0 Cache W</span>` +
    `<span style="color:${cCR}">\u25A0 Cache R</span>` +
  `</div>`;

  const totalVal = tokTotal.available ? tokTotal.value : 0;
  const sTotalVal = sessTotal.available ? sessTotal.value : 0;

  // LEFT COLUMN — All-time
  const left =
    `<div style="flex:1;display:flex;flex-direction:column;gap:8px;padding-right:10px;border-right:1px solid ${dim}22">` +
      `<div>` +
        sectionTitle('All-Time Tokens') +
        `<div style="color:${pri};font-size:3.52cqw;font-weight:700;margin:2px 0">${fmtTok(totalVal)}</div>` +
        tokBar(tokIn.value||0, tokOut.value||0, tokCW.value||0, tokCR.value||0, totalVal) +
        legend +
        `<div style="margin-top:6px">` +
          statRow('Input', fmtTok(tokIn.value||0), cIn) +
          statRow('Output', fmtTok(tokOut.value||0), cOut) +
          statRow('Cache Write', fmtTok(tokCW.value||0), cCW) +
          statRow('Cache Read', fmtTok(tokCR.value||0), cCR) +
        `</div>` +
      `</div>` +
      `<div>` +
        sectionTitle('Messages') +
        `<div style="display:flex;gap:12px;align-items:baseline">` +
          `<span style="color:${pri};font-size:3.52cqw;font-weight:700">${fmtNum(msgsTotal)}</span>` +
          `<span style="color:${dim};font-size:1.37cqw">total</span>` +
        `</div>` +
        statRow('User', fmtNum(msgsUser)) +
        statRow('Assistant', fmtNum(msgsAsst)) +
      `</div>` +
      `<div>` +
        sectionTitle('Monthly Average') +
        statRow('Tokens', fmtTok(monthlyTok.value||0)) +
        statRow('Messages', fmtNum(monthlyMsg)) +
        statRow('Active Days', days.available ? days.value : '--') +
        statRow('Sessions', sessions.available ? sessions.value : '--') +
      `</div>` +
    `</div>`;

  // RIGHT COLUMN — Session + Live
  const sparkData = spark.available ? spark.value : [];

  const right =
    `<div style="flex:1;display:flex;flex-direction:column;gap:8px;padding-left:10px">` +
      `<div>` +
        sectionTitle('This Session') +
        `<div style="color:${pri};font-size:3.52cqw;font-weight:700;margin:2px 0">${fmtTok(sTotalVal)}</div>` +
        tokBar(sessIn.value||0, sessOut.value||0, sessCW.value||0, sessCR.value||0, sTotalVal) +
        `<div style="margin-top:6px">` +
          statRow('Input', fmtTok(sessIn.value||0), cIn) +
          statRow('Output', fmtTok(sessOut.value||0), cOut) +
          statRow('Cache Write', fmtTok(sessCW.value||0), cCW) +
          statRow('Cache Read', fmtTok(sessCR.value||0), cCR) +
          statRow('Messages', fmtNum(sessMsgs)) +
        `</div>` +
      `</div>` +
      `<div>` +
        sectionTitle('Token Rate') +
        `<div style="margin:4px 0">` +
          sparkline(sparkData, pri, 400, 50) +
        `</div>` +
        `<div style="color:${pri};font-size:2.34cqw;font-weight:700">` +
          `${fmtNum(rate, '0')} <span style="color:${dim};font-size:1.37cqw">tok/min</span>` +
        `</div>` +
      `</div>` +
      `<div>` +
        sectionTitle('Agents') +
        `<div style="display:flex;align-items:center;gap:8px">` +
          `<span style="color:${pri};font-size:3.52cqw;font-weight:700">${agents.available ? agents.value : 0}</span>` +
          `<span style="color:${dim};font-size:1.56cqw">spawned this session</span>` +
        `</div>` +
      `</div>` +
    `</div>`;

  return '<div class="screen-frame" style="font-family:' + font + '">' +
    '<div style="display:flex;height:100%;padding:12px 16px;gap:0;box-sizing:border-box">' +
      left + right +
    '</div></div>';
}

/* ── Bridge Station: shared primitives, then the GPU screen ──────────────────────────────────────────────────────────
 * One screen, three densities, chosen from how many cards the collector
 * actually found. The same build has to read correctly on a single-card
 * workstation and on a four-card rig, and nobody should have to configure
 * which. Authored in px against the 1024x600 kiosk, emitted in cqw so the
 * control-panel preview and a phone scale with the frame.
 *
 *   1 card   layout A - both gauges, load bars, per-process VRAM
 *   2 cards  layout B - a gauge and a bar stack each
 *   3+       layout C - compact 2x2 tiles
 *   0        an honest empty state; the screen can be switched off in Settings
 */

/* px -> cqw against the 1024px kiosk width. */
function gq(px) { return (px / 1024 * 100).toFixed(3) + 'cqw'; }

/* Gold and Coral glow; Teal deliberately does not. A skin that says no gets
   the declaration omitted rather than set to `none`, so there is nothing for
   a later rule to have to override. */
function bsGlow(px, color, alpha) {
  return bsS().glow ? `text-shadow:0 0 ${gq(px)} ${color}${alpha || '99'}` : '';
}

/* ── Skins ───────────────────────────────────────────────────────────────
 * The Bridge Station layout is one set of code; the chrome that frames it is
 * per family. Gold draws a glowing spine down the left of every region, Teal
 * an angular chevron tab across the top, Coral a rounded pill. Fonts, palette,
 * bar geometry and thermal colours come out of the skin too, so the screens
 * below never name a colour that belongs to one family only.
 *
 * Three copies of this layout would have drifted apart by the second edit.
 */
const _T = PANEL_SPEC.teal || {};
const _C = PANEL_SPEC.coral || {};

/* Gold: a hard-edged 12px spine, segmented bars, wide uppercase tracking. */
const BS_SKIN_GOLD = {
  key: 'gold', font: "'Chakra Petch', sans-serif", fw: '700', bg: '#000',
  label: '#d8d8d8',        /* mid-greys disappear on a cheap 7" panel */
  dim: '#9a9a9a', bright: '#ffffff', text: '#e6e6e6', soft: '#dcdcdc',
  track: '#161616', edge: '#202020', ring: '#141414',
  r: 0, ls: '0.22em', seg: true, glow: true,
  a1: GOLD, a2: TEAL, a3: AMBER, a4: GREEN,
  dCpu: GOLD, dRam: PANEL_SPEC.colors.blue, dVram: GREEN,
  cPrimary: GOLD, cSecondary: TEAL,
  cLink: GREEN, cPing: AMBER, cRecv: PANEL_SPEC.colors.thermBlue || '#2288DD',
  cSend: GREEN, cIp: '#efefef', cMac: '#cfcfcf',
  kHour: GOLD, kSec: AMBER, kDay: GREEN, kDate: '#dcdcdc',
  crit: PANEL_SPEC.colors.red, warn: PANEL_SPEC.colors.thermOrange || '#FF7700',
  cPower: AMBER, tick: '#b4b4b4',
  therm: _thermColor,
  vNvidia: GREEN, vAmd: PANEL_SPEC.colors.red, vIntel: PANEL_SPEC.colors.blue,
};

/* Teal: chevron tabs, navy tracks, 2px corners, Rajdhani semibold, no glow. */
const BS_SKIN_TEAL = {
  key: 'teal', font: "'Rajdhani', sans-serif", fw: '600', bg: _T.void || '#111419',
  label: _T.steel || '#9EA5BA', dim: _T.slate || '#6D748C',
  bright: _T.pale || '#AAAACC', text: _T.pale || '#AAAACC', soft: _T.steel || '#9EA5BA',
  track: _T.navy || '#2F3749', edge: _T.navy || '#2F3749', ring: _T.navy || '#2F3749',
  r: 2, ls: '0.15em', seg: false, glow: false,
  a1: _T.teal || '#2A9D8F', a2: _T.lavender || '#8888BB',
  a3: _T.burnt || '#E7442A', a4: _T.cyan || '#66CCCC',
  dCpu: _T.burnt || '#E7442A', dRam: _T.teal || '#2A9D8F', dVram: _T.lavender || '#8888BB',
  cPrimary: _T.teal || '#2A9D8F', cSecondary: _T.lavender || '#8888BB',
  cLink: _T.teal || '#2A9D8F', cPing: _T.warm || '#CCAA77',
  cRecv: _T.lavender || '#8888BB', cSend: _T.teal || '#2A9D8F',
  cIp: _T.pale || '#AAAACC', cMac: _T.steel || '#9EA5BA',
  kHour: _T.pale || '#AAAACC', kSec: _T.burnt || '#E7442A',
  kDay: _T.teal || '#2A9D8F', kDate: _T.lavender || '#8888BB',
  crit: _T.alert || '#FF4444', warn: _T.thermOrange || '#DD7733',
  cPower: _T.warm || '#CCAA77', tick: _T.steel || '#9EA5BA',
  therm: function (t) {
    if (t >= 90) return _T.thermOrange || '#DD7733';
    if (t >= 70) return _T.thermYellow || '#CCAA44';
    if (t >= 50) return _T.thermGreen || '#55AA77';
    return _T.thermBlue || '#4488AA';
  },
  vNvidia: _T.thermGreen || '#55AA77', vAmd: _T.thermOrange || '#DD7733',
  vIntel: _T.thermBlue || '#4488AA',
};

/* Coral: rounded pills, fully rounded bars, Antonio at its regular weight. */
const BS_SKIN_CORAL = {
  key: 'coral', font: "'Antonio', sans-serif", fw: '400', bg: '#000',
  label: _C.tanoi || '#FFCC99', dim: '#A67FA6',
  bright: _C.paleCanary || '#FFFF99', text: _C.paleCanary || '#FFFF99',
  soft: _C.tanoi || '#FFCC99',
  track: '#1a1a2a', edge: '#26263a', ring: '#1a1a2a',
  r: 999, ls: '0.15em', seg: false, glow: true,
  a1: _C.goldenTanoi || '#FFCC66', a2: _C.anakiwa || '#99CCFF',
  a3: _C.neonCarrot || '#FF9933', a4: _C.lilac || '#CC99CC',
  dCpu: _C.neonCarrot || '#FF9933', dRam: _C.anakiwa || '#99CCFF',
  dVram: _C.lilac || '#CC99CC',
  cPrimary: _C.goldenTanoi || '#FFCC66', cSecondary: _C.lilac || '#CC99CC',
  cLink: _C.anakiwa || '#99CCFF', cPing: _C.neonCarrot || '#FF9933',
  cRecv: _C.mariner || '#3366CC', cSend: _C.anakiwa || '#99CCFF',
  cIp: _C.paleCanary || '#FFFF99', cMac: _C.tanoi || '#FFCC99',
  kHour: _C.goldenTanoi || '#FFCC66', kSec: _C.tanoi || '#FFCC99',
  kDay: _C.anakiwa || '#99CCFF', kDate: _C.lilac || '#CC99CC',
  crit: _C.mars || '#FF2200', warn: _C.thermOrange || '#FF9933',
  cPower: _C.neonCarrot || '#FF9933', tick: _C.tanoi || '#FFCC99',
  therm: function (t) {
    if (t >= 90) return _C.thermOrange || '#FF9933';
    if (t >= 70) return _C.thermYellow || '#FFCC66';
    if (t >= 50) return _C.thermGreen || '#99CC66';
    return _C.thermBlue || '#99CCFF';
  },
  vNvidia: _C.thermGreen || '#99CC66', vAmd: _C.neonCarrot || '#FF9933',
  vIntel: _C.anakiwa || '#99CCFF',
};

/* The active skin. Every screen entry point sets it before rendering; the
   fallback keeps a stray call from rendering nothing rather than throwing. */
let _bsSkin = BS_SKIN_GOLD;
function bsSkin(s) { _bsSkin = s || BS_SKIN_GOLD; }
function bsS() { return _bsSkin; }

function gpuVendorColor(vendor) {
  const S = bsS();
  if (vendor === 'NVIDIA') return S.vNvidia;
  if (vendor === 'AMD') return S.vAmd;
  if (vendor === 'Intel') return S.vIntel;
  return S.a1;
}

/* A value the driver never reported is shown as absent. Printing 0 where the
   card said nothing is a lie the renderer cannot take back. */
function bsVal(v, suffix) {
  if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '--';
  return esc(String(v)) + (suffix || '');
}

function bsNum(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : 0;
}

/* One section of the board. The rectangle and the body layout are shared;
   only the chrome that frames them changes between families. */
function bsRegion(x, y, w, h, title, color, right, body, justify) {
  const S = bsS();
  const inset = S.key === 'gold' ? 28 : 0;      /* clear of the spine */
  const top = S.key === 'gold' ? 32 : 36;       /* clear of the tab */
  return `<div style="position:absolute;left:${gq(x)};top:${gq(y)};width:${gq(w)};height:${gq(h)}">` +
    (S.key === 'gold' ? _bsChromeSpine(title, color, right)
                      : _bsChromeTab(title, color, right)) +
    `<div style="position:absolute;left:${gq(inset)};top:${gq(top)};right:0;bottom:${gq(6)};` +
      `display:flex;flex-direction:column;justify-content:${justify || 'space-between'};` +
      `overflow:hidden">${body}</div></div>`;
}

/* Gold: a glowing spine down the left edge, the title floating beside it. */
function _bsChromeSpine(title, color, right) {
  const S = bsS(), SW = 12;
  return `<div style="position:absolute;left:0;top:0;width:${gq(SW)};height:100%;background:${color};` +
      `border-radius:${gq(SW / 2)};box-shadow:0 0 ${gq(18)} ${color}66"></div>` +
    `<div style="position:absolute;left:${gq(SW + 16)};top:0;color:${color};font-family:${S.font};` +
      `font-size:${gq(16)};font-weight:${S.fw};text-transform:uppercase;letter-spacing:${S.ls};` +
      `${bsGlow(10, color)};white-space:nowrap">${title}</div>` +
    (right ? `<div style="position:absolute;right:0;top:${gq(2)};color:${color};font-family:${S.font};` +
      `font-size:${gq(13)};font-weight:${S.fw};text-transform:uppercase;letter-spacing:${S.ls};` +
      `opacity:0.85;white-space:nowrap">${right}</div>` : '');
}

/* Teal and Coral: a header tab across the top, a rule running out of it, and
   the status text riding the rule's far end. Teal's tab is chamfered, Coral's
   is a pill -- the one shape each family already used everywhere else. */
function _bsChromeTab(title, color, right) {
  const S = bsS(), HH = 26;
  const pill = S.key === 'coral';
  const nose = pill ? ''
    : `<svg width="${gq(18)}" height="${gq(HH)}" viewBox="0 0 14 20" style="flex-shrink:0">` +
      `<polygon points="14,0 14,20 0,20" fill="${color}"/></svg>`;
  return `<div style="position:absolute;left:0;top:0;width:100%;height:${gq(HH)};` +
      `display:flex;align-items:center;gap:${pill ? gq(9) : '0'}">` + nose +
    `<div style="background:${color};height:100%;padding:0 ${gq(15)};display:flex;align-items:center;` +
      `border-radius:${pill ? '999px' : '0'};flex-shrink:0">` +
      `<span style="color:#000;font-family:${S.font};font-size:${gq(16)};font-weight:${S.fw};` +
        `text-transform:uppercase;letter-spacing:${S.ls};white-space:nowrap">${title}</span></div>` +
    `<div style="flex:1;height:${gq(pill ? 5 : 3)};background:${color};` +
      `border-radius:${pill ? '999px' : '0'};opacity:${pill ? '1' : '0.4'}"></div>` +
    (right ? `<span style="color:${color};font-family:${S.font};font-size:${gq(15)};` +
      `font-weight:${S.fw};text-transform:uppercase;letter-spacing:${S.ls};` +
      `margin-left:${gq(9)};white-space:nowrap">${right}</span>` : '') + `</div>`;
}

/* A meter. Gold segments it, and a non-zero reading always lights at least
   one cell: a real but sub-1% value drawn as a wholly empty bar reads as
   broken rather than small. Teal and Coral keep the continuous track they
   already used everywhere, squared off or fully rounded to taste. */
function bsSegBar(pct, color, w, h, cells, gap) {
  const S = bsS();
  const p = Math.max(0, Math.min(100, bsNum(pct)));
  if (!S.seg) {
    const r = S.r >= 999 ? '999px' : S.r + 'px';
    return `<div style="width:${gq(w)};height:${gq(h)};background:${S.track};border-radius:${r};` +
      `overflow:hidden;flex-shrink:0"><div style="height:100%;width:${p}%;background:${color};` +
      `border-radius:${r};transition:width 0.8s ease"></div></div>`;
  }
  const cw = (w - gap * (cells - 1)) / cells;
  let n = Math.round(cells * p / 100);
  if (n === 0 && p > 0) n = 1;
  let html = `<div style="display:flex;gap:${gq(gap)};align-items:center">`;
  for (let i = 0; i < cells; i++) {
    html += `<div style="width:${gq(cw)};height:${gq(h)};flex-shrink:0;` +
      (i < n ? `background:${color};box-shadow:0 0 ${gq(6)} ${color}aa` :
               `background:${S.track};border:1px solid ${S.edge}`) + `"></div>`;
  }
  return html + `</div>`;
}

function bsKv(label, value, color, valPx, labPx) {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:${gq(12)}">` +
    `<span style="color:${bsS().label};font-family:${bsS().font};font-size:${gq(labPx || 13)};font-weight:${bsS().fw};` +
      `text-transform:uppercase;letter-spacing:${bsS().ls};white-space:nowrap">${label}</span>` +
    `<span style="color:${color};font-family:${bsS().font};font-size:${gq(valPx || 22)};font-weight:${bsS().fw};` +
      `font-variant-numeric:tabular-nums;white-space:nowrap;${bsGlow(8, color, '99')}">${value}</span></div>`;
}

/* A readout bound to the width of its own bar. Letting it span the flex row
   pushed the number to the far edge, where it read as labelling the next
   column rather than the bar beneath it. */
function bsMetered(label, value, pct, color, w, cells, valPx, labPx) {
  return `<div style="width:${gq(w)}">` + bsKv(label, value, color, valPx, labPx) +
    bsSegBar(pct, color, w, valPx && valPx < 20 ? 8 : 11, cells, 3) + `</div>`;
}

/* sysfs reports real RPM, NVML only a duty percentage. Show whichever the card
   actually gave rather than inventing a conversion between them. */
function gpuFanText(card) {
  if (card.fan_rpm !== null && card.fan_rpm !== undefined) return bsVal(card.fan_rpm) + ' RPM';
  if (card.fan !== null && card.fan !== undefined) return bsVal(card.fan, '%');
  return '--';
}

function gpuFanRpm(card) {
  if (card.fan_rpm !== null && card.fan_rpm !== undefined) return bsNum(card.fan_rpm);
  if (card.fan !== null && card.fan !== undefined) return Math.round(bsNum(card.fan) / 100 * 2400);
  return 0;
}

function gpuPowerPct(card) {
  const p = card.power, lim = card.power_limit;
  if (typeof p !== 'number' || typeof lim !== 'number' || lim <= 0) return 0;
  return Math.round(p / lim * 100);
}

/* Percentage of a limit, as TEXT. A card that reported no power at all has no
   percentage either -- rendering the 0 that gpuPowerPct returns for the bar
   would state a draw of zero watts, which is not what the driver said. */
function gpuPowerPctText(card) {
  const p = card.power, lim = card.power_limit;
  if (typeof p !== 'number' || typeof lim !== 'number' || lim <= 0) return '--';
  return Math.round(p / lim * 100) + '%';
}

function gpuName(card) {
  return esc(String(card.short_name || card.name || 'GPU ' + bsNum(card.index)));
}

function gpuTempColor(card) {
  return (card.temp === null || card.temp === undefined) ? bsS().dim : bsS().therm(card.temp);
}

/* Donut with its caption BELOW the ring. The shared donut() puts the label
   above, which overflows the top of a vertically-centred region and gets
   clipped by its overflow:hidden. */
function bsGauge(pct, caption, color, size, sw, opts) {
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:${gq(4)}">` +
    donut(pct, '', color, size, sw, bsS().font, opts) +
    `<div style="color:${bsS().label};font-family:${bsS().font};font-size:${gq(13)};font-weight:${bsS().fw};` +
      `line-height:1;text-transform:uppercase;letter-spacing:${bsS().ls}">${caption}</div></div>`;
}

/* ── layout A: one card, everything ── */
function gpuLayoutSingle(card) {
  const S = bsS();
  const col = gpuVendorColor(card.vendor);
  const tc = gpuTempColor(card);
  const dOpts = {anticlockwise: true, ticks: S.seg, bgRing: bsS().ring, valColor: bsS().bright,
                 critColor: bsS().bright, linecap: 'butt', valSize: gq(44), labelSize: gq(13),
                 labelColor: bsS().label};

  const head = `<div style="position:absolute;left:${gq(24)};top:${gq(16)};right:${gq(24)};` +
    `display:flex;align-items:center;gap:${gq(14)};font-family:${bsS().font}">` +
    `<span style="font-size:${gq(11)};font-weight:${bsS().fw};color:#000;background:${col};` +
      `padding:${gq(2)} ${gq(9)};border-radius:2px;text-transform:uppercase;letter-spacing:${bsS().ls};` +
      `box-shadow:0 0 ${gq(12)} ${col}88">${esc(String(card.vendor || 'GPU'))}</span>` +
    `<span style="color:${bsS().bright};font-size:${gq(27)};font-weight:${bsS().fw};${bsGlow(10, col, '99')};` +
      `overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${gpuName(card)}</span>` +
    `<span style="flex:1"></span>` +
    `<span style="color:${bsS().label};font-size:${gq(12)};font-weight:${bsS().fw};text-transform:uppercase;` +
      `letter-spacing:${bsS().ls};white-space:nowrap">${bsVal(card.driver)} &nbsp;|&nbsp; ${bsVal(card.bus_id)}</span></div>`;

  const utilBody = (card.util === null || card.util === undefined)
    ? `<div style="color:${bsS().dim};font-family:${bsS().font};font-size:${gq(13)};font-weight:${bsS().fw};` +
      `text-transform:uppercase;letter-spacing:${bsS().ls};text-align:center">NOT EXPOSED BY ${bsVal(card.driver).toUpperCase()}</div>`
    : `<div style="display:flex;justify-content:center">${bsGauge(bsNum(card.util), 'UTILISATION', col, 152, 11, dOpts)}</div>`;

  const vramBody = (card.vram_percent === null || card.vram_percent === undefined)
    ? `<div style="color:${bsS().dim};font-family:${bsS().font};font-size:${gq(13)};font-weight:${bsS().fw};` +
      `text-transform:uppercase;letter-spacing:${bsS().ls};text-align:center">NOT EXPOSED BY ${bsVal(card.driver).toUpperCase()}</div>`
    : `<div style="display:flex;justify-content:center">${bsGauge(bsNum(card.vram_percent), 'VRAM', S.a2, 152, 11, dOpts)}</div>`;

  const procs = asList({available: true, value: card.processes});
  let procBody, procRight;
  if (procs.length) {
    procBody = '';
    for (let i = 0; i < Math.min(3, procs.length); i++) {
      const pr = procs[i] || {};
      const tot = bsNum(card.vram_total);
      const pct = tot > 0 ? Math.round(bsNum(pr.vram_mib) / tot * 100) : 0;
      procBody += `<div style="display:flex;align-items:center;gap:${gq(12)};font-family:${bsS().font}">` +
        `<span style="color:${bsS().bright};font-size:${gq(17)};font-weight:${bsS().fw};width:${gq(118)};overflow:hidden;` +
          `text-overflow:ellipsis;white-space:nowrap">${esc(String(pr.name || '?'))}</span>` +
        `<span style="color:${bsS().dim};font-size:${gq(13)};width:${gq(54)}">${bsVal(pr.pid)}</span>` +
        bsSegBar(pct, S.a2, 560, 13, 30, 3) +
        `<span style="color:${bsS().text};font-size:${gq(16)};font-weight:${bsS().fw};width:${gq(74)};text-align:right;` +
          `font-variant-numeric:tabular-nums">${bsVal(pr.vram_mib)}M</span></div>`;
    }
    procRight = procs.length + ' ACTIVE';
  } else if (card.source === 'nvml') {
    // An empty list from NVML means the card is idle, NOT that the data is
    // unavailable. Saying "not exposed by nvidia" here was simply false.
    procBody = `<div style="color:${bsS().dim};font-family:${bsS().font};font-size:${gq(13)};font-weight:${bsS().fw};` +
      `text-transform:uppercase;letter-spacing:${bsS().ls}">NO COMPUTE PROCESSES ON THIS CARD</div>`;
    procRight = 'IDLE';
  } else {
    // sysfs genuinely has no per-process accounting. Say that, rather than
    // leaving a box that looks like it failed to load.
    procBody = `<div style="color:${bsS().dim};font-family:${bsS().font};font-size:${gq(13)};font-weight:${bsS().fw};` +
      `text-transform:uppercase;letter-spacing:${bsS().ls}">PER-PROCESS VRAM NOT EXPOSED BY ${bsVal(card.driver).toUpperCase()}</div>`;
    procRight = 'UNAVAILABLE';
  }

  return head +
    bsRegion(24, 62, 300, 240, 'PROCESSOR', col, '', utilBody, 'center') +
    bsRegion(348, 62, 300, 240, 'MEMORY', S.a2, '', vramBody, 'center') +
    bsRegion(672, 62, 328, 240, 'TELEMETRY', S.a1, '',
      bsKv('TEMP', bsVal(card.temp, '°C'), tc, 30) +
      bsKv('POWER', bsVal(card.power) + ` <span style="font-size:${gq(16)};color:${bsS().dim}">/ ${bsVal(card.power_limit)} W</span>`, S.cPower, 30) +
      bsKv('CORE', bsVal(card.clock_gpu) + ` <span style="font-size:${gq(16)};color:${bsS().dim}">/ ${bsVal(card.clock_gpu_max)} MHz</span>`, '#e6e6e6', 26) +
      bsKv('MEMORY', bsVal(card.clock_mem) + ` <span style="font-size:${gq(16)};color:${bsS().dim}">MHz</span>`, '#e6e6e6', 26),
      'space-around') +
    bsRegion(24, 312, 624, 116, 'LOAD', col, '',
      bsMetered('POWER DRAW', gpuPowerPctText(card), gpuPowerPct(card), S.cPower, 596, 34, 14, 12) +
      bsMetered('MEMORY CONTROLLER', bsVal(card.mem_util, '%'), bsNum(card.mem_util), S.a2, 596, 34, 14, 12),
      'space-around') +
    bsRegion(672, 312, 328, 116, 'COOLING', tc, '',
      `<div style="display:flex;align-items:center;gap:${gq(18)}">` +
        fanIcon(tc, gq(54), gpuFanRpm(card)) +
        `<div><div style="color:${bsS().bright};font-family:${bsS().font};font-size:${gq(30)};font-weight:${bsS().fw};` +
          `font-variant-numeric:tabular-nums;${bsGlow(8, tc, '99')}">${gpuFanText(card)}</div>` +
        `<div style="color:${bsS().label};font-family:${bsS().font};font-size:${gq(12)};font-weight:${bsS().fw};` +
          `text-transform:uppercase;letter-spacing:${bsS().ls}">FAN</div></div></div>`, 'center') +
    bsRegion(24, 446, 976, 132, 'PROCESSES', S.a2, procRight, procBody, 'space-around');
}

/* ── layout B: two cards ── */
function gpuCardPanel(card, x, y, w, h) {
  const S = bsS();
  const col = gpuVendorColor(card.vendor);
  const tc = gpuTempColor(card);
  const dOpts = {anticlockwise: true, ticks: S.seg, bgRing: bsS().ring, valColor: bsS().bright,
                 critColor: bsS().bright, linecap: 'butt', valSize: gq(38), labelSize: gq(12)};

  const stats = `<div style="display:flex;flex-direction:column;justify-content:center;gap:${gq(11)}">` +
    bsMetered('VRAM', bsVal(card.vram_used) + ` <span style="font-size:${gq(15)};color:${bsS().dim}">/ ${bsVal(card.vram_total)} MiB</span>`,
               bsNum(card.vram_percent), S.a2, 330, 26, 23, 13) +
    bsMetered('POWER', bsVal(card.power) + ` <span style="font-size:${gq(15)};color:${bsS().dim}">/ ${bsVal(card.power_limit)} W</span>`,
               gpuPowerPct(card), S.cPower, 330, 26, 23, 13) +
    bsMetered('MEM CTRL', bsVal(card.mem_util, '%'), bsNum(card.mem_util), S.a1, 330, 26, 23, 13) +
    `</div>`;

  // Fixed width, not flex:1. Stretching this column ran its labels back
  // underneath the bars in the middle column.
  const right = `<div style="width:${gq(236)};display:flex;flex-direction:column;justify-content:center;gap:${gq(11)}">` +
    bsKv('TEMP', bsVal(card.temp, '°C'), tc, 26) +
    bsKv('CORE', bsVal(card.clock_gpu) + ` <span style="font-size:${gq(14)};color:${bsS().dim}">MHz</span>`, '#e6e6e6', 22) +
    `<div style="display:flex;align-items:center;gap:${gq(12)}">` + fanIcon(tc, gq(30), gpuFanRpm(card)) +
      `<span style="color:${bsS().text};font-family:${bsS().font};font-size:${gq(17)};font-weight:${bsS().fw};` +
      `${bsGlow(6, tc, '99')}">${gpuFanText(card)}</span></div></div>`;

  const inner = `<div style="display:flex;align-items:center;gap:${gq(34)};height:100%">` +
    donut(bsNum(card.util), '', col, 138, 10, bsS().font, dOpts) +
    stats + `<div style="flex:1"></div>` + right + `</div>`;

  return bsRegion(x, y, w, h, gpuName(card), col,
    bsVal(card.driver) + ' &nbsp;|&nbsp; ' + bsVal(card.bus_id), inner, 'center');
}

/* ── layout C: three or more ── */
function gpuTile(card, x, y, w, h) {
  const S = bsS();
  const col = gpuVendorColor(card.vendor);
  const tc = gpuTempColor(card);
  const dOpts = {anticlockwise: true, ticks: S.seg, bgRing: bsS().ring, valColor: bsS().bright,
                 critColor: bsS().bright, linecap: 'butt', valSize: gq(29), labelSize: gq(11)};
  // Used keeps a decimal at every magnitude -- rounding 18.3 to 18 on a 24G
  // card throws away the only digit that moves. The total is a fixed board
  // spec, so an integer is right there.
  const gibUsed = function (mib) { return (bsNum(mib) / 1024).toFixed(1); };
  const gibTotal = function (mib) { return Math.round(bsNum(mib) / 1024); };

  const stack = `<div style="display:flex;flex-direction:column;gap:${gq(9)}">` +
    bsMetered('VRAM', gibUsed(card.vram_used) + ` <span style="font-size:${gq(12)};color:${bsS().dim}">/ ${gibTotal(card.vram_total)} G</span>`,
               bsNum(card.vram_percent), S.a2, 214, 20, 19, 11) +
    bsMetered('POWER', bsVal(card.power) + ` <span style="font-size:${gq(12)};color:${bsS().dim}">/ ${bsVal(card.power_limit)} W</span>`,
               gpuPowerPct(card), S.cPower, 214, 20, 19, 11) + `</div>`;

  const footer = `<div style="display:flex;align-items:center;gap:${gq(14)};margin-top:${gq(12)};font-family:${bsS().font}">` +
    fanIcon(tc, gq(24), gpuFanRpm(card)) +
    `<span style="color:${bsS().text};font-size:${gq(16)};font-weight:${bsS().fw}">${bsVal(card.temp, '°C')}</span>` +
    `<span style="flex:1"></span>` +
    `<span style="color:${bsS().label};font-size:${gq(11)};font-weight:${bsS().fw};text-transform:uppercase;` +
      `letter-spacing:${bsS().ls};white-space:nowrap">${bsVal(card.clock_gpu)} MHz</span></div>`;

  const inner = `<div style="display:flex;align-items:center;gap:${gq(16)}">` +
    donut(bsNum(card.util), '', col, 104, 8, bsS().font, dOpts) + stack + `</div>` + footer;

  return bsRegion(x, y, w, h, gpuName(card), col, bsVal(card.util, '%'), inner, 'center');
}

function gpuHeader(cards) {
  let watts = 0, anyPower = false;
  for (const c of cards) {
    if (typeof c.power === 'number' && isFinite(c.power)) { watts += c.power; anyPower = true; }
  }
  const total = anyPower ? ` &nbsp;|&nbsp; ${Math.round(watts)} W TOTAL` : '';
  return `<div style="position:absolute;left:${gq(24)};top:${gq(14)};right:${gq(24)};` +
    `display:flex;align-items:baseline;gap:${gq(14)};font-family:${bsS().font}">` +
    `<span style="color:${bsS().a1};font-size:${gq(19)};font-weight:${bsS().fw};text-transform:uppercase;` +
      `letter-spacing:${bsS().ls};${bsGlow(10, bsS().a1, '99')}">GRAPHICS</span>` +
    `<span style="flex:1"></span>` +
    `<span style="color:${bsS().label};font-size:${gq(13)};font-weight:${bsS().fw};text-transform:uppercase;` +
      `letter-spacing:${bsS().ls}">${cards.length} CARD${cards.length === 1 ? '' : 'S'}${total}</span></div>`;
}

function bsGpuScreen(c) {
  const cards = asList(m('gpu.cards'));
  const frame = (body) => `<div class="screen-frame"><div style="position:relative;width:100%;` +
    `height:100%;background:${bsS().bg};font-family:${bsS().font};overflow:hidden">${body}</div></div>`;

  if (!cards.length) {
    // A machine with no card the collector can read. Say so plainly; the
    // screen can be switched off in Settings > Screen Rotation.
    return frame(`<div style="position:absolute;inset:0;display:flex;flex-direction:column;` +
      `align-items:center;justify-content:center;gap:${gq(10)}">` +
      `<div style="color:${bsS().a1};font-size:${gq(19)};font-weight:${bsS().fw};text-transform:uppercase;` +
        `letter-spacing:${bsS().ls};${bsGlow(10, bsS().a1, '99')}">GRAPHICS</div>` +
      `<div style="color:${bsS().dim};font-size:${gq(15)};font-weight:${bsS().fw};text-transform:uppercase;` +
        `letter-spacing:${bsS().ls}">NO GPU DETECTED</div></div>`);
  }

  if (cards.length === 1) return frame(gpuLayoutSingle(cards[0]));

  if (cards.length === 2) {
    return frame(gpuHeader(cards) +
      gpuCardPanel(cards[0], 24, 52, 976, 254) +
      gpuCardPanel(cards[1], 24, 324, 976, 254));
  }

  const pos = [[24, 52], [516, 52], [24, 322], [516, 322]];
  let body = gpuHeader(cards);
  for (let i = 0; i < Math.min(4, cards.length); i++) {
    body += gpuTile(cards[i], pos[i][0], pos[i][1], 484, 248);
  }
  // Beyond four the grid has no room; say what is not shown rather than
  // silently truncating the list.
  if (cards.length > 4) {
    body += `<div style="position:absolute;right:${gq(24)};bottom:${gq(4)};color:${bsS().dim};` +
      `font-family:${bsS().font};font-size:${gq(12)};font-weight:${bsS().fw};text-transform:uppercase;` +
      `letter-spacing:${bsS().ls}">+${cards.length - 4} MORE NOT SHOWN</div>`;
  }
  return frame(body);
}

function panelGoldGpuScreen(c) { bsSkin(BS_SKIN_GOLD); return bsGpuScreen(c); }
function panelTealGpuScreen(c) { bsSkin(BS_SKIN_TEAL); return bsGpuScreen(c); }
function panelCoralGpuScreen(c) { bsSkin(BS_SKIN_CORAL); return bsGpuScreen(c); }

/* ── Bridge Station: screen 1 ────────────────────────────────────────────
 * CORE / THERMALS / COMMS / CHRONOMETER, in the same spine vocabulary as the
 * GPU screen so the Gold family reads as one theme rather than two.
 *
 * The NPU readout that used to hold the fourth quadrant moves to its own
 * screen: on a 1024x600 panel it was four lines of text competing with the
 * clock, and a local model server deserves the room the GPU screen gets.
 */

/* Thermal row: label, segmented track, reading. The track is segmented rather
   than continuous so a glance reads roughly how hot without parsing digits. */
function bsThermRow(label, temp, w) {
  const known = (temp !== null && temp !== undefined && isFinite(temp));
  const c = known ? _thermColor(temp) : bsS().dim;
  // The scale runs 20-120C, matching the tick labels printed beneath it.
  const pct = known ? Math.max(0, Math.min(100, ((temp - 20) / 100) * 100)) : 0;
  return `<div style="display:flex;align-items:center;gap:${gq(11)}">` +
    `<span style="color:${bsS().label};font-family:${bsS().font};font-size:${gq(13)};font-weight:${bsS().fw};` +
      `text-transform:uppercase;letter-spacing:${bsS().ls};width:${gq(34)};flex-shrink:0">${label}</span>` +
    bsSegBar(pct, c, w, 16, 14, 4) +
    `<span style="color:${c};font-family:${bsS().font};font-size:${gq(18)};font-weight:${bsS().fw};` +
      `width:${gq(52)};text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;` +
      `${bsGlow(8, c, '99')}">${known ? Math.round(temp) + '&deg;' : '--'}</span></div>`;
}

/* One icon per fan detected, each turning at its own rate.
   No RPM readout on purpose: fans in a group do not share a speed, so a
   single number was an average that hid the very thing worth seeing. */
function bsFanGroup(label, color, rpms) {
  if (!rpms.length) return '';
  let icons = '';
  for (const r of rpms) icons += fanIcon(color, gq(26), r);
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:${gq(6)}">` +
    `<div style="display:flex;gap:${gq(9)}">${icons}</div>` +
    `<div style="color:${bsS().label};font-family:${bsS().font};font-size:${gq(12)};font-weight:${bsS().fw};` +
      `line-height:1;text-transform:uppercase;letter-spacing:${bsS().ls}">${label}</div></div>`;
}

function bsWiredIcon(color, lit) {
  const halo = bsS().glow ? `;filter:drop-shadow(0 0 ${gq(6)} ${color})` : '';
  return `<svg width="${gq(26)}" height="${gq(26)}" viewBox="0 0 24 24" ` +
    `style="opacity:${lit ? 1 : 0.3}${halo}">` +
    `<rect x="4" y="9" width="16" height="9" rx="1.5" fill="${color}"/>` +
    `<rect x="9" y="4" width="6" height="5" fill="${color}"/>` +
    `<rect x="7" y="18" width="2" height="3" fill="${color}"/>` +
    `<rect x="15" y="18" width="2" height="3" fill="${color}"/></svg>`;
}

function bsWifiIcon(color, lit) {
  return `<svg width="${gq(22)}" height="${gq(22)}" viewBox="0 0 24 24" ` +
    `style="opacity:${lit ? 1 : 0.3}"><g fill="none" stroke="${color}" ` +
    `stroke-width="2" stroke-linecap="round">` +
    `<path d="M4 9a13 13 0 0 1 16 0"/><path d="M7.5 13a8 8 0 0 1 9 0"/></g>` +
    `<circle cx="12" cy="17.5" r="1.8" fill="${color}"/></svg>`;
}

/* Capacity bar with its own readout, bound to the bar's width. */
function bsCapacityBar(label, cap, pct, color, w) {
  return `<div style="width:${gq(w)}">` +
    `<div style="display:flex;justify-content:space-between;align-items:baseline;` +
      `margin-bottom:${gq(5)}">` +
      `<span style="color:${bsS().label};font-family:${bsS().font};font-size:${gq(12)};font-weight:${bsS().fw};` +
        `text-transform:uppercase;letter-spacing:${bsS().ls}">${label}</span>` +
      `<span style="color:${bsS().soft};font-family:${bsS().font};font-size:${gq(14)};font-weight:${bsS().fw};` +
        `font-variant-numeric:tabular-nums">${cap}</span></div>` +
    bsSegBar(pct, color, w, bsS().seg ? 11 : 15, 26, 3) + `</div>`;
}

/* Gold segments its thermal track; Teal and Coral keep the continuous bar
   they already had. Same reading either way -- label, track, degrees. */
function bsThermRowSolid(label, temp, w) {
  const S = bsS();
  const known = (temp !== null && temp !== undefined && isFinite(temp));
  const c = known ? S.therm(temp) : S.dim;
  const pct = known ? Math.max(0, Math.min(100, ((temp - 20) / 100) * 100)) : 0;
  const flash = known && temp >= 100 ? ';animation:blink 0.5s infinite' : '';
  const r = S.r >= 999 ? '999px' : S.r + 'px';
  return `<div style="display:flex;align-items:center;gap:${gq(11)}">` +
    `<span style="color:${S.label};font-family:${S.font};font-size:${gq(15)};font-weight:${S.fw};` +
      `text-transform:uppercase;letter-spacing:${S.ls};width:${gq(38)};flex-shrink:0">${label}</span>` +
    `<div style="width:${gq(w)};height:${gq(18)};background:${S.track};border-radius:${r};` +
      `overflow:hidden;flex-shrink:0"><div style="height:100%;width:${pct}%;background:${c};` +
      `border-radius:${r};transition:width 0.8s ease${flash}"></div></div>` +
    `<span style="color:${c};font-family:${S.font};font-size:${gq(19)};font-weight:${S.fw};` +
      `width:${gq(52)};text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;` +
      `${bsGlow(8, c)}">${known ? Math.round(temp) + '&deg;' : '--'}</span></div>`;
}

/* ── Bridge Station: screen 1, in whichever skin is active ────────────────
 * CORE / THERMALS / COMMS / CHRONOMETER. One information layout across the
 * whole Panel family: the same readings land in the same quadrant whichever
 * theme is on, so switching themes never means re-learning the board.
 */
function bsScreen1(c) {
  const S = bsS();

  const cpu = m('cpu.usage'), ram = m('mem.ram_percent'), vram = m('gpu.vram_percent');
  const root = m('disk.root_used'), rootPct = m('disk.root_percent');
  const home = m('disk.home_used'), homePct = m('disk.home_percent');
  const cpuT = m('cpu.temp'), mbT = m('cpu.mb_temp'), gpuT = m('gpu.temp');
  const ip = m('net.ip'), mac = m('net.mac'), iface = m('net.iface');
  const speed = m('net.speed'), dl = m('net.dl'), ul = m('net.ul'), ping = m('net.ping');
  const host = m('sys.hostname');

  const dOpts = {anticlockwise: true, ticks: S.key === 'gold', bgRing: S.ring,
                 valColor: S.bright, critColor: S.crit, linecap: 'butt',
                 fontWeight: S.fw, valSize: gq(30), labelSize: gq(12)};

  // ── CORE
  const core =
    `<div style="display:flex;justify-content:space-around;align-items:center">` +
      bsGauge(bsNum(cpu.available ? cpu.value : 0), 'CPU', S.dCpu, 104, 9, dOpts) +
      bsGauge(bsNum(ram.available ? ram.value : 0), 'RAM', S.dRam, 104, 9, dOpts) +
      bsGauge(bsNum(vram.available ? vram.value : 0), 'GPU VRAM', S.dVram, 104, 9, dOpts) +
    `</div>` +
    `<div style="display:flex;flex-direction:column;gap:${gq(11)};margin-top:${gq(14)}">` +
      bsCapacityBar('PRIMARY', `${fmtCapacity(root)} / ${fmtCapacityTotal(root)}`,
                    bsNum(rootPct.available ? rootPct.value : 0), S.cPrimary, 428) +
      (home.available
        ? bsCapacityBar('SECONDARY', `${fmtCapacity(home)} / ${fmtCapacityTotal(home)}`,
                        bsNum(homePct.available ? homePct.value : 0), S.cSecondary, 428)
        : `<div style="color:${S.dim};font-family:${S.font};font-size:${gq(13)};font-weight:${S.fw};` +
          `text-transform:uppercase;letter-spacing:${S.ls}">SECONDARY &mdash; NONE</div>`) +
    `</div>`;

  // ── THERMALS
  const temps = [cpuT, mbT, gpuT].filter(t => t.available).map(t => t.value);
  const hottest = temps.length ? Math.max.apply(null, temps) : null;
  const status = hottest === null ? 'NO SENSORS'
               : hottest >= 110 ? 'CRITICAL' : hottest >= 90 ? 'WARNING' : 'NOMINAL';
  const statusColor = hottest === null ? S.dim
                    : hottest >= 110 ? S.crit : hottest >= 90 ? S.warn : S.therm(60);

  // The scale has to start and stop exactly where the bars do, or the tick
  // labels point at temperatures the bars never reach.
  const labW = S.seg ? 34 : 38, gap = 11, scaleW = S.seg ? 300 : 340;
  const bodyW = 486 - (S.key === 'gold' ? 28 : 0);
  let scale = `<div style="display:flex;justify-content:space-between;` +
    `margin-left:${gq(labW + gap)};margin-right:${gq(bodyW - labW - gap - scaleW)}">`;
  for (const t of [20, 50, 70, 90, 110, 120]) {
    scale += `<span style="color:${S.tick};font-family:${S.font};font-size:${gq(12)}">${t}</span>`;
  }
  scale += `</div>`;

  const row = S.seg ? bsThermRow : bsThermRowSolid;
  const therm =
    `<div style="display:flex;flex-direction:column;gap:${gq(9)}">` +
      row('CPU', cpuT.available ? cpuT.value : null, scaleW) +
      row('MB', mbT.available ? mbT.value : null, scaleW) +
      row('GPU', gpuT.available ? gpuT.value : null, scaleW) +
      scale +
    `</div>` + bsFanRow();

  // ── COMMS
  const linkUp = ip.available;
  const speedStr = speed.available
    ? (speed.value >= 1000 ? Math.round(speed.value / 1000) + ' GbE' : speed.value + ' Mb')
    : '--';
  const identity =
    `<div style="display:flex;justify-content:flex-end;align-items:center;gap:${gq(12)}">` +
      bsWiredIcon(linkUp ? S.cLink : S.dim, linkUp) +
      `<div style="text-align:right">` +
        `<div style="color:${S.bright};font-family:${S.font};font-size:${gq(21)};font-weight:${S.fw};` +
          `line-height:1.05;${bsGlow(8, S.bright)}">` +
          `${iface.available ? esc(String(iface.value)) : '--'}</div>` +
        `<div style="color:${linkUp ? S.cLink : S.dim};font-family:${S.font};font-size:${gq(11)};` +
          `font-weight:${S.fw};margin-top:${gq(2)};text-transform:uppercase;letter-spacing:${S.ls}">` +
          `${linkUp ? 'LINK ACTIVE' : 'NO LINK'}</div></div>` +
      `<div style="display:flex;flex-direction:column;align-items:center;gap:${gq(1)};` +
        `margin-left:${gq(4)}">` + bsWifiIcon(S.dim, false) +
        `<span style="color:${S.dim};font-family:${S.font};font-size:${gq(9)};font-weight:${S.fw};` +
        `text-transform:uppercase;letter-spacing:${S.ls}">OFF</span></div></div>`;

  const unit = (d) => `<span style="font-size:${gq(13)};color:${S.dim}">${esc(String(d.unit))}</span>`;
  const comms = identity +
    `<div style="display:grid;grid-template-columns:1fr 1fr;column-gap:${gq(22)};` +
      `row-gap:${gq(18)}">` +
      bsKv('LINK', speedStr, S.cLink, 22) +
      bsKv('PING', ping.available ? bsNum(ping.value).toFixed(1) + ' ms' : '--', S.cPing, 22) +
      bsKv('RECV', dl.available ? `${esc(String(dl.value))} ${unit(dl)}` : '--', S.cRecv, 22) +
      bsKv('SEND', ul.available ? `${esc(String(ul.value))} ${unit(ul)}` : '--', S.cSend, 22) +
      bsKv('IP', ip.available ? esc(String(ip.value)) : '--', S.cIp, 18) +
      bsKv('MAC', mac.available ? esc(String(mac.value)) : '--', S.cMac, 15) +
    `</div>`;

  // ── CHRONOMETER
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mmn = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST',
                  'SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const chrono =
    `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;` +
      `height:100%;gap:${gq(2)}">` +
      `<div style="display:flex;align-items:baseline;gap:${gq(8)}">` +
        `<span style="color:${S.kHour};font-family:${S.font};font-size:${gq(72)};font-weight:${S.fw};` +
          `line-height:1;font-variant-numeric:tabular-nums;` +
          `${bsGlow(26, S.kHour, '66')}">${hh}:${mmn}</span>` +
        `<span style="color:${S.kSec};font-family:${S.font};font-size:${gq(32)};font-weight:${S.fw};` +
          `font-variant-numeric:tabular-nums;${bsGlow(14, S.kSec)}">${ss}</span></div>` +
      `<div style="color:${S.kDay};font-family:${S.font};font-size:${gq(19)};font-weight:${S.fw};` +
        `letter-spacing:0.3em;margin-top:${gq(12)};text-transform:uppercase;` +
        `${bsGlow(10, S.kDay)}">${days[now.getDay()]}</div>` +
      `<div style="color:${S.kDate};font-family:${S.font};font-size:${gq(15)};font-weight:${S.fw};` +
        `letter-spacing:${S.ls};text-transform:uppercase">` +
        `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}</div></div>`;

  return `<div class="screen-frame"><div style="position:relative;width:100%;height:100%;` +
    `background:${S.bg};font-family:${S.font};overflow:hidden">` +
    bsRegion(16, 18, 486, 272, 'CORE', S.a1,
             host.available ? esc(String(host.value).toUpperCase()) : '', core, 'space-between') +
    bsRegion(522, 18, 486, 272, 'CHRONOMETER', S.a1, '', chrono, 'center') +
    bsRegion(16, 312, 486, 272, 'THERMALS', S.a3,
             `<span style="color:${statusColor}">${status}</span>`, therm, 'space-evenly') +
    bsRegion(522, 312, 486, 272, 'COMMS', S.a2, '', comms, 'space-evenly') +
    `</div></div>`;
}

/* Gold labels each fan group and colours it; Teal and Coral keep the compact
   monochrome strip they already used, so their thermals panel is untouched. */
function bsFanRow() {
  const S = bsS();
  if (S.key !== 'gold') {
    return `<div style="display:flex;justify-content:center;align-items:center">` +
      fanStrip(S.label, S.font, '') + `</div>`;
  }
  const cpuFans = asList(m('cpu.fans_cpu'));
  const caseFans = asList(m('cpu.fans_case'));
  const gpuFanPct = m('gpu.fan');
  // gpu.fan is a duty percentage, not a tachometer reading; map it onto a
  // comparable range so the icon turns at a rate the eye can compare.
  const gpuFans = gpuFanPct.available && gpuFanPct.value !== null
    ? [Math.round(bsNum(gpuFanPct.value) / 100 * 2400)] : [];
  if (!cpuFans.length && !caseFans.length && !gpuFans.length) {
    return `<div style="color:${S.dim};font-family:${S.font};font-size:${gq(12)};` +
      `font-weight:${S.fw};text-align:center;text-transform:uppercase;` +
      `letter-spacing:${S.ls}">NO FANS DETECTED</div>`;
  }
  return `<div style="display:flex;justify-content:space-around;align-items:flex-end">` +
    bsFanGroup('CPU', S.a1, cpuFans) + bsFanGroup('CASE', S.a2, caseFans) +
    bsFanGroup('GPU', S.dVram, gpuFans) + `</div>`;
}

function panelGoldScreen1(c) { bsSkin(BS_SKIN_GOLD); return bsScreen1(c); }
function panelTealScreen1(c) { bsSkin(BS_SKIN_TEAL); return bsScreen1(c); }
function panelCoralScreen1(c) { bsSkin(BS_SKIN_CORAL); return bsScreen1(c); }
