'use strict';
/* Metric fixtures shared by the renderer harness. Each fixture is a
   {key: {value, unit, available, extra}} map matching the /api/metrics shape.
   Key names are taken from the real collectors -- notably disk.root_* /
   disk.home_*, because disk.py derives the suffix from the mountpoint. */

function mval(value, unit, extra) {
  return { value: value, unit: unit || '', available: true, extra: extra || {} };
}

// Every metric present and plausible. Disk under 1 TiB so the collector
// would have emitted GiB.
const FULL = {
  'sys.hostname': mval('chiketi-pi'),
  'sys.uptime': mval('3d 4h 12m', '', { seconds: 274320 }),
  'sys.kernel': mval('6.11.0-19-generic'),
  'sys.top_procs': mval([
    { name: 'llama-server', pid: 4412, cpu: 68.4, mem: 22.1 },
    { name: 'chromium', pid: 2201, cpu: 12.9, mem: 6.4 },
    { name: 'python3', pid: 41207, cpu: 8.1, mem: 3.2 },
    { name: 'Xorg', pid: 1180, cpu: 3.4, mem: 1.1 },
  ], '', { total: 284 }),
  'cpu.usage': mval(42.5, '%'),
  'cpu.per_core': mval([10, 20, 30, 40, 50, 60, 70, 80], '%'),
  'cpu.temp': mval(61, '°C'),
  'cpu.mb_temp': mval(38, '°C'),
  'cpu.fan': mval(1200, 'RPM'),
  'cpu.fan_count': mval(4),
  'cpu.fans_cpu': mval([1200, 1300], '', { count: 2 }),
  'cpu.fans_case': mval([800, 900], '', { count: 2 }),
  'mem.ram_used': mval(12.3, 'GiB', { total: 31.2, percent: 39.4 }),
  'mem.ram_total': mval(31.2, 'GiB'),
  'mem.ram_percent': mval(39.4, '%'),
  'mem.swap_used': mval(0.5, 'GiB', { total: 8.0, percent: 6.3 }),
  'mem.swap_total': mval(8.0, 'GiB'),
  'mem.swap_percent': mval(6.3, '%'),
  'sessions.status': mval('ok'),
  'sessions.list': mval([
    { name: 'kiosk-deploy-ef', project: 'kiosk-deploy', state: 'busy', since: Math.floor(Date.now() / 1000) - 6, message: null, tokens: 4105932, agents: 2 },
    { name: 'ai-fabric-5f', project: 'ai-fabric', state: 'idle', since: Math.floor(Date.now() / 1000) - 10680, message: null, tokens: 148943157, agents: 0 },
    { name: 'nfs2seredux-e0', project: 'nfs2seredux', state: 'waiting', since: Math.floor(Date.now() / 1000) - 240,
      message: 'Claude needs your permission to use Bash', tokens: 8847279, agents: 0 },
    { name: 'home-b0', project: '~', state: 'idle', since: Math.floor(Date.now() / 1000) - 25200, message: null, tokens: 1175947, agents: 0 },
    { name: 'Refactor GPU probe', project: 'chiketi', state: 'idle', since: Math.floor(Date.now() / 1000) - 50000, message: null, tokens: 512340, agents: 0, tool: 'codex' },
    { name: 'tests-a1', project: 'chiketi', state: 'shell', since: Math.floor(Date.now() / 1000) - 75, message: null, tokens: 23410, agents: 1 },
  ]),
  'sessions.checked_at': mval(Math.floor(Date.now() / 1000) - 1, 's', { poll_seconds: 2, host: 'devbox' }),
  'homelab.status': mval('ok'),
  'homelab.hosts': mval([
    { name: 'Atlas', state: 'ok' }, { name: 'Vesta', state: 'ok' },
    { name: 'devbox', state: 'ok' }, { name: 'gpubox', state: 'ok' },
    { name: 'Lcdhost', state: 'ok' }, { name: 'chiketi-server', state: 'ok' },
    { name: 'pfSense', state: 'ok' }, { name: 'Home Assistant', state: 'ok' },
  ]),
  'homelab.issues': mval([]),
  'homelab.checked_at': mval(Math.floor(Date.now() / 1000) - 5, 's', { poll_seconds: 30 }),
  'homelab.gpus': mval([
    { host: 'gpubox', index: 0, name: 'Tesla V100-PCIE-32GB', util: 87, vram_used: 30100, vram_total: 32768,
      temp: 71, power: 231, power_limit: 250, fan: null, procs: 2, state: 'busy', detail: true,
      seen_at: Math.floor(Date.now() / 1000) - 5 },
    { host: 'gpubox', index: 1, name: 'Tesla V100-PCIE-32GB', util: 0, vram_used: 4, vram_total: 32768,
      temp: 38, power: 26, power_limit: 250, fan: null, procs: 0, state: 'idle', detail: true,
      seen_at: Math.floor(Date.now() / 1000) - 5 },
  ], '', { published_at: Math.floor(Date.now() / 1000) - 5, stale_after: 182, warn_c: 85, crit_c: 92 }),
  'homelab.gpu_hosts': mval([{ host: 'gpubox', outcome: 'ok' }, { host: 'devbox', outcome: 'none' }]),
  'disk.root_used': mval(120.5, 'GiB', { total: 500.0, percent: 24.1 }),
  'disk.root_total': mval(500.0, 'GiB'),
  'disk.root_percent': mval(24.1, '%'),
  'disk.home_used': mval(300.0, 'GiB', { total: 900.0, percent: 33.3 }),
  'disk.home_total': mval(900.0, 'GiB'),
  'disk.home_percent': mval(33.3, '%'),
  'net.ip': mval('192.0.2.66'),
  'net.mac': mval('AA:BB:CC:DD:EE:FF'),
  'net.iface': mval('eno1'),
  'net.speed': mval(1000, 'Mbps'),
  'net.ping': mval(11.4, 'ms'),
  'net.dl': mval(12.4, 'MB/s', { raw_bytes_per_sec: 12400000 }),
  'net.ul': mval(1.1, 'MB/s', { raw_bytes_per_sec: 1100000 }),
  'gpu.name': mval('NVIDIA GeForce RTX 4090'),
  'gpu.temp': mval(65, '°C'),
  'gpu.fan': mval(45, '%'),
  'gpu.power': mval(220, 'W', { limit: 450 }),
  'gpu.vram_used': mval(8192, 'MiB', { total: 24576, percent: 33.3 }),
  'gpu.vram_total': mval(24576, 'MiB'),
  'gpu.vram_percent': mval(33.3, '%'),
  'gpu.util': mval(72, '%'),
  'gpu.mem_util': mval(40, '%'),
  'gpu.clock_gpu': mval(2400, 'MHz', { max: 2600 }),
  'gpu.clock_mem': mval(10500, 'MHz', { max: 10501 }),
  'gpu.processes': mval([{ pid: 1234, name: 'llama-server', vram_mib: 7000 }]),
  'gpu.count': mval(1),
  'gpu.cards': mval([gpuCard()], '', { count: 1 }),
  'llama.status': mval('Running'),
  'llama.backend': mval('llama.cpp'),
  'llama.health': mval('ok'),
  'llama.model': mval('Qwen2.5-32B-Instruct-Q4_K_M.gguf'),
  'llama.quant': mval('Q4_K_M'),
  'llama.context': mval(32768),
  'llama.active_slots': mval(1, '', { total: 4 }),
  'llama.tok_per_sec': mval(38.2, 't/s'),
  'llama.processes': mval([{ pid: 1234, model: 'Qwen2.5-32B-Instruct-Q4_K_M.gguf' }], '', { count: 1 }),
  'claude.tokens_input': mval(1200000),
  'claude.tokens_output': mval(340000),
  'claude.tokens_cache_write': mval(900000),
  'claude.tokens_cache_read': mval(48000000),
  'claude.tokens_total': mval(50440000),
  'claude.msgs_user': mval(4200),
  'claude.msgs_assistant': mval(5100),
  'claude.msgs_total': mval(9300),
  'claude.monthly_tokens': mval(12000000),
  'claude.monthly_messages': mval(2300),
  'claude.days_active': mval(126),
  'claude.sessions': mval(480),
  'claude.session_input': mval(12000),
  'claude.session_output': mval(3400),
  'claude.session_cache_write': mval(9000),
  'claude.session_cache_read': mval(480000),
  'claude.session_total': mval(504400),
  'claude.session_msgs': mval(42),
  'claude.agents_active': mval(3),
  'claude.token_rate': mval(18000, 'tok/min'),
  'claude.sparkline': mval([100, 500, 2000, 18000, 4000, 900, 12000, 300, 50, 7000]),
};

// Nothing collected yet: every m() lookup misses.
/* One entry of gpu.cards, in the exact shape chiketi.collectors.gpu emits.
   Overrides let a fixture null out individual fields the way a driver that
   does not implement them does. */
function gpuCard(over) {
  return Object.assign({
    index: 0, source: 'nvml', vendor: 'NVIDIA', driver: 'nvidia',
    bus_id: '0000:01:00.0',
    name: 'AD102 [GeForce RTX 4090]', short_name: 'GeForce RTX 4090',
    util: 97, mem_util: 58,
    vram_used: 18734, vram_total: 24564, vram_percent: 76.3,
    temp: 67, power: 389, power_limit: 450, fan: 62, fan_rpm: null,
    clock_gpu: 2520, clock_gpu_max: 2520, clock_mem: 10501, clock_mem_max: 10501,
    processes: [{ pid: 41207, name: 'python3', vram_mib: 17980 },
                { pid: 3312, name: 'ollama', vram_mib: 610 },
                { pid: 2201, name: 'Xorg', vram_mib: 144 }]
  }, over || {});
}

const AMD_CARD = {
  index: 1, source: 'sysfs', vendor: 'AMD', driver: 'amdgpu',
  bus_id: '0000:03:00.0',
  name: 'Navi 31 [Radeon RX 7900 XT/7900 XTX/7900M]',
  short_name: 'Radeon RX 7900 XT',
  util: 73, mem_util: 41, vram_used: 9100, vram_total: 24560, vram_percent: 37.1,
  temp: 61, power: 211, power_limit: 355, fan: 50, fan_rpm: 1450,
  clock_gpu: 1800, clock_gpu_max: 2482, clock_mem: 1249, clock_mem_max: 1249,
  processes: []
};

function withCards(cards) {
  const o = Object.assign({}, FULL);
  o['gpu.count'] = mval(cards.length);
  o['gpu.cards'] = mval(cards, '', { count: cards.length });
  return o;
}

// The three densities the screen selects between, plus the empty case.
const GPU_NONE = (function () { return withCards([]); })();
const GPU_DUAL = (function () { return withCards([gpuCard(), AMD_CARD]); })();
const GPU_QUAD = (function () {
  return withCards([
    gpuCard(), AMD_CARD,
    Object.assign({}, AMD_CARD, { index: 2, short_name: 'Radeon RX 6700',
      bus_id: '0000:04:00.0', util: 12, mem_util: 4, vram_used: 1200,
      vram_total: 12288, vram_percent: 9.8, temp: 39, power: 28,
      fan: 0, fan_rpm: 0, clock_gpu: 500, clock_gpu_max: 2321 }),
    Object.assign({}, AMD_CARD, { index: 3, short_name: 'Radeon RX 7800 XT',
      bus_id: '0000:06:00.0', util: 44, vram_total: 16384, temp: 52, power: 140 })
  ]);
})();
// More cards than the grid has room for: the overflow must be declared, not
// silently dropped.
const GPU_MANY = (function () {
  const cards = [];
  for (let i = 0; i < 7; i++) {
    cards.push(Object.assign({}, AMD_CARD, { index: i, bus_id: '0000:0' + i + ':00.0' }));
  }
  return withCards(cards);
})();

// A driver that implements almost nothing -- i915/xe expose neither
// utilisation nor VRAM through sysfs. Every one of these must render as
// absent, never as a zero the viewer would read as "idle".
const GPU_SPARSE = (function () {
  return withCards([{
    index: 0, source: 'sysfs', vendor: 'Intel', driver: 'i915',
    bus_id: '0000:05:00.0', name: 'DG2 [Arc A770]', short_name: 'Arc A770',
    util: null, mem_util: null, vram_used: null, vram_total: null,
    vram_percent: null, temp: 48, power: null, power_limit: null,
    fan: null, fan_rpm: null, clock_gpu: 1650, clock_gpu_max: 2400,
    clock_mem: null, clock_mem_max: null, processes: []
  }]);
})();

// Hostile strings INSIDE the card objects and their process lists. The
// top-level HOSTILE sweep cannot reach these -- gpu.cards is a list of
// objects, not a string -- and card names come from pci.ids and process
// names from the OS, so neither is ours to trust.
const XSS = '<video src=x onerror=alert(1)>';
const GPU_HOSTILE = (function () {
  return withCards([
    gpuCard({ name: XSS, short_name: XSS, vendor: XSS, driver: XSS, bus_id: XSS,
              processes: [{ pid: XSS, name: XSS, vram_mib: XSS }] }),
    Object.assign({}, AMD_CARD, { short_name: XSS, driver: XSS, bus_id: XSS })
  ]);
})();

// available:true with a value that is not a list. A collector returning None
// for a field it normally fills must not crash the renderer.
const GPU_MALFORMED = (function () {
  const o = Object.assign({}, FULL);
  o['gpu.cards'] = mval(null);
  o['gpu.count'] = mval(3);
  return o;
})();

// An idle NVML card: the process list is empty because nothing is using the
// GPU, NOT because NVML cannot report it. The screen must not conflate those.
const GPU_IDLE = (function () {
  return withCards([gpuCard({ util: 0, mem_util: 0, vram_used: 458,
                              vram_percent: 1.9, temp: 48, power: 25,
                              fan: 0, clock_gpu: 210, processes: [] })]);
})();

const EMPTY = {};

// Every metric flagged unavailable (collector caught an exception).
const UNAVAILABLE = (function () {
  const o = {};
  for (const k of Object.keys(FULL)) {
    o[k] = { value: null, unit: FULL[k].unit, available: false, extra: {} };
  }
  return o;
})();

// available:true with a null value. No collector emits this today, but a
// renderer must not throw on it -- this fixture is what keeps that true.
const NULL_VALUES = (function () {
  const o = {};
  for (const k of Object.keys(FULL)) {
    o[k] = { value: null, unit: FULL[k].unit, available: true, extra: {} };
  }
  return o;
})();

// Disks at/over 1 TiB: the collector switches to TiB units here.
// This fixture is what proves the disk formatter bug is fixed.
const LARGE_DISK = (function () {
  const o = Object.assign({}, FULL);
  o['disk.root_used'] = mval(1.5, 'TiB', { total: 2.0, percent: 75.0 });
  o['disk.root_total'] = mval(2.0, 'TiB');
  o['disk.root_percent'] = mval(75.0, '%');
  o['disk.home_used'] = mval(1.2, 'TiB', { total: 4.0, percent: 30.0 });
  o['disk.home_total'] = mval(4.0, 'TiB');
  o['disk.home_percent'] = mval(30.0, '%');
  return o;
})();

// Hostile strings in every string-valued metric.
const HOSTILE = (function () {
  const o = {};
  for (const k of Object.keys(FULL)) {
    const v = FULL[k];
    o[k] = typeof v.value === 'string'
      ? { value: XSS, unit: v.unit, available: true, extra: v.extra }
      : v;
  }
  return o;
})();

// An Ollama backend. Proves the LLM panel title is derived from
// llama.backend instead of hardcoding LLAMA.CPP.
const OLLAMA = (function () {
  const o = Object.assign({}, FULL);
  o['llama.backend'] = mval('ollama');
  o['llama.model'] = mval('qwen3:32b');
  return o;
})();

function sessionsFixture(status, list, checkedAgo) {
  const f = Object.assign({}, FULL);
  f['sessions.status'] = mval(status);
  if (list !== undefined) f['sessions.list'] = mval(list);
  if (checkedAgo === null) {
    f['sessions.checked_at'] = { value: null, unit: 's', available: false, extra: { poll_seconds: 2, host: '' } };
  }
  return f;
}
const SESS_EMPTY = sessionsFixture('ok', []);
const SESS_MANY = sessionsFixture('ok', (function () {
  const out = [];
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 14; i++) {
    out.push({ name: 'session-' + i, project: 'proj' + i, state: ['waiting', 'busy', 'shell', 'idle'][i % 4],
               since: now - i * 400, message: i % 4 === 0 ? 'needs input ' + i : null });
  }
  return out;
})());
const SESS_OFFLINE = sessionsFixture('offline');
const SESS_PENDING = sessionsFixture('pending', [], null);
const SESS_UNCONFIGURED = (function () {
  const f = Object.assign({}, FULL);
  delete f['sessions.list']; delete f['sessions.checked_at'];
  f['sessions.status'] = mval('unconfigured');
  return f;
})();
const SESS_HOSTILE = sessionsFixture('ok', [
  { name: XSS, project: XSS, state: 'waiting', since: Math.floor(Date.now() / 1000) - 5, message: XSS },
  { name: 'b', project: 'p', state: XSS, since: XSS, message: null },
]);

function homelab(status, issues, hostStates, checkedAgo) {
  const f = Object.assign({}, FULL);
  f['homelab.status'] = mval(status);
  f['homelab.issues'] = mval(issues);
  if (hostStates) {
    f['homelab.hosts'] = mval(FULL['homelab.hosts'].value.map(function (h, i) {
      return { name: h.name, state: hostStates[i] || 'ok' };
    }));
  }
  if (checkedAgo !== undefined) {
    f['homelab.checked_at'] = mval(Math.floor(Date.now() / 1000) - checkedAgo, 's', { poll_seconds: 30 });
  }
  return f;
}
const NOW_S = Math.floor(Date.now() / 1000);
const HL_YELLOW = homelab('warn', [
  { host: 'gpubox', key: 'fs:/', severity: 'warn', title: '/ 88% full', detail: 'filesystem space', since: NOW_S - 600 },
], ['ok', 'ok', 'ok', 'warn']);
const HL_RED = homelab('crit', (function () {
  const out = [{ host: 'Atlas', key: 'unraid_disk:disk2', severity: 'crit', title: 'disk2 DISK_DSBL', detail: 'Unraid disk status', since: NOW_S - 3600 }];
  for (let i = 0; i < 11; i++) {
    out.push({ host: 'devbox', key: 'x:' + i, severity: 'warn', title: 'Issue ' + i, detail: 'detail ' + i, since: NOW_S - i * 60 });
  }
  return out;
})(), ['crit', 'ok', 'warn']);
const HL_STALE = homelab('ok', [], null, 3600);
const HL_PENDING = (function () {
  const f = homelab('pending', []);
  f['homelab.checked_at'] = { value: null, unit: 's', available: false, extra: { poll_seconds: 30 } };
  f['homelab.gpus'] = { value: [], unit: '', available: false, extra: { published_at: null, stale_after: 182 } };
  f['homelab.gpu_hosts'] = { value: [], unit: '', available: false, extra: {} };
  return f;
})();
const HL_UNCONFIGURED = (function () {
  const f = Object.assign({}, FULL);
  ['homelab.hosts', 'homelab.issues', 'homelab.checked_at', 'homelab.gpus', 'homelab.gpu_hosts']
    .forEach(function (k) { delete f[k]; });
  f['homelab.status'] = mval('unconfigured');
  return f;
})();
/* A Kiosk house with neither Kiosk screen set up: both tabs grey, the notice shows. */
const KIOSK_EMPTY = (function () {
  const f = Object.assign({}, HL_UNCONFIGURED);
  delete f['sessions.list']; delete f['sessions.checked_at'];
  f['sessions.status'] = mval('unconfigured');
  return f;
})();
const HL_HOSTILE = (function () {
  const f = homelab('crit', [
    { host: XSS, key: XSS, severity: 'crit', title: XSS, detail: XSS, since: NOW_S },
  ]);
  f['homelab.hosts'] = mval([{ name: XSS, state: 'crit' }, { name: 'ok', state: XSS }]);
  return f;
})();

/* A busy day, as the server sends it: critical first, then oldest. Vesta's probe
   fails (down), pfSense's gateway port is shut (gw), Home Assistant answers 500
   (api: reachable but unhealthy). Nine hosts, fifteen issues. */
const HL_BUSY = (function () {
  const I = function (host, key, sev, title, detail, ago) {
    return { host: host, key: key, severity: sev, title: title, detail: detail, since: NOW_S - ago };
  };
  const issues = [
    I('Atlas', 'unraid_disk:disk3', 'crit', 'disk3 DISK_DSBL', 'Unraid disk status', 5400),
    I('Vesta', 'down', 'crit', 'Unreachable', 'ssh: connect timed out', 1260),
    I('gpubox', 'gpu_temp:1', 'crit', 'GPU 1 92°C', '', 300),
    I('pfSense', 'gw', 'crit', 'Gateway unreachable', '192.0.2.1 not answering', 200),
    I('Home Assistant', 'api', 'crit', 'API answered 500', 'http://192.0.2.20/api', 120),
    I('buildbox', 'updates', 'warn', '14 security updates', 'apt', 172800),
    I('devbox', 'updates', 'warn', '6 security updates', 'apt', 90000),
    I('Atlas', 'unraid_array', 'warn', 'Array 91% full', 'Unraid array space', 86000),
    I('Lcdhost', 'units', 'warn', '2 failed units', 'lcd-snap.service, apt-daily.service', 7200),
    I('devbox', 'fs:/', 'warn', '/ 88% full', 'filesystem space', 3600),
    I('Atlas', 'smart:sda:5', 'warn', 'Disk sda: reallocated 32216→32296', 'SMART attribute 5', 2640),
    I('Atlas', 'disk_temp:sdc', 'warn', 'Disk sdc 52°C', 'drive temperature', 1800),
    I('chiketi-server', 'backup_api', 'warn', 'Backup status unavailable', 'HTTP 504 from backup API', 900),
    I('gpubox', 'gpu_throttle:0', 'warn', 'GPU 0 throttling', 'clock slowdown reported by the driver', 660),
    I('gpubox', 'mem', 'warn', 'Memory 9% available', 'memory', 420),
  ];
  const names = ['Atlas', 'Vesta', 'devbox', 'gpubox', 'Lcdhost', 'chiketi-server', 'pfSense', 'Home Assistant', 'buildbox'];
  const f = homelab('crit', issues);
  f['homelab.hosts'] = mval(names.map(function (n) {
    const mine = issues.filter(function (i) { return i.host === n; });
    return { name: n, state: mine.some(function (i) { return i.severity === 'crit'; }) ? 'crit' : mine.length ? 'warn' : 'ok' };
  }));
  return f;
})();
/* A host whose check has not produced a result yet. */
const HL_UNKNOWN = (function () {
  const f = homelab('ok', []);
  f['homelab.hosts'] = mval(FULL['homelab.hosts'].value.map(function (h, i) {
    return { name: h.name, state: i === 2 ? 'unknown' : 'ok' };
  }));
  return f;
})();

/* GPUs: rows as homelab.gpus carries them (state worked out by the poller). */
function gpuRow(host, index, state, over) {
  return Object.assign({ host: host, index: index, name: 'Tesla V100-PCIE-32GB', util: 50, vram_used: 18432,
    vram_total: 32768, temp: 64, power: 180, power_limit: 250, fan: null, procs: 1, state: state,
    detail: true, seen_at: NOW_S - 5 }, over || {});
}
function gpuHouse(rows, hosts, over) {
  const f = Object.assign({}, FULL);
  f['homelab.gpus'] = mval(rows, '', Object.assign({ published_at: NOW_S - 5, stale_after: 182,
    warn_c: 85, crit_c: 92 }, over || {}));
  f['homelab.gpu_hosts'] = mval(hosts || [{ host: 'gpubox', outcome: 'ok' }, { host: 'devbox', outcome: 'none' }]);
  return f;
}
const GPU_STATES = ['idle', 'busy', 'unknown', 'nodetail', 'offline', 'unreadable', 'throttling', 'hot', 'critical'];
const GPU_HOUSE = gpuHouse(GPU_STATES.map(function (s, i) {
  const over = s === 'nodetail' ? { util: null, vram_used: null, vram_total: null, power: null, power_limit: null,
    procs: null, detail: false } : s === 'critical' ? { temp: 95 } : s === 'hot' ? { temp: 87 } : {};
  if (s !== 'nodetail') over.mem_temp = i === 0 ? null : 84;    // the memory sensor, where a card has one
  return gpuRow(i < 5 ? 'gpubox' : 'devbox', i, s, over);
}), [{ host: 'gpubox', outcome: 'ok' }, { host: 'devbox', outcome: 'ok' }]);
const GPU_HOUSE_TIES = gpuHouse([gpuRow('devbox', 1, 'busy'), gpuRow('gpubox', 1, 'busy'), gpuRow('devbox', 0, 'hot', { temp: 87 }),
  gpuRow('gpubox', 0, 'busy'), gpuRow('gpubox', 2, 'hot', { temp: 88 }), gpuRow('devbox', 2, 'busy')],
  [{ host: 'gpubox', outcome: 'ok' }, { host: 'devbox', outcome: 'ok' }]);
const GPU_HOUSE_NONE = gpuHouse([], [{ host: 'gpubox', outcome: 'none' }]);
const GPU_HOUSE_INCOMPLETE = gpuHouse([], [{ host: 'gpubox', outcome: 'offline' }]);
const GPU_HOUSE_PENDING_WITH_ROWS = gpuHouse([gpuRow('gpubox', 0, 'busy')],
  [{ host: 'gpubox', outcome: 'ok' }, { host: 'a-very-long-host-name-<b>x</b>', outcome: 'pending' }]);
const GPU_HOUSE_INCOMPLETE_WITH_ROWS = gpuHouse([gpuRow('gpubox', 0, 'busy')],
  [{ host: 'gpubox', outcome: 'ok' }, { host: 'a-very-long-host-name-<b>x</b>', outcome: 'pending' },
   { host: 'constructor', outcome: 'unreadable' }]);
const GPU_HOUSE_STALE = gpuHouse([gpuRow('gpubox', 0, 'critical', { temp: 95 })], null, { published_at: NOW_S - 9999 });
const GPU_HOUSE_STALE_EMPTY = gpuHouse([], [{ host: 'gpubox', outcome: 'none' }], { published_at: NOW_S - 9999 });
const GPU_HOUSE_SPARSE = gpuHouse([gpuRow('gpubox', 0, 'unknown', { util: null, vram_used: null, vram_total: 0,
  temp: null, power: null, power_limit: null, procs: null })]);
const GPU_HOUSE_MIXED_POWER = gpuHouse([gpuRow('gpubox', 0, 'busy'), gpuRow('gpubox', 1, 'idle', { power: null }),
  gpuRow('devbox', 0, 'offline')], [{ host: 'gpubox', outcome: 'ok' }, { host: 'devbox', outcome: 'offline' }]);
const GPU_HOUSE_ONE_OFFLINE = gpuHouse([gpuRow('gpubox', 0, 'busy', { power: 100 }), gpuRow('gpubox', 1, 'offline')]);
const GPU_HOUSE_MANY = gpuHouse(Array.from({ length: 12 }, function (_, i) { return gpuRow('gpubox', i, i % 2 ? 'idle' : 'busy'); }));
const GPU_HOUSE_OLD = gpuHouse([gpuRow('gpubox', 0, 'unreadable', { power: 231, seen_at: NOW_S - 90000 }),
  gpuRow('gpubox', 1, 'offline', { power: 231, seen_at: NOW_S - 90000 })], [{ host: 'gpubox', outcome: 'unreadable' }]);
const GPU_HOUSE_LONG_HOSTS = gpuHouse([gpuRow('gpubox', 0, 'busy')], [{ host: 'gpubox', outcome: 'ok' },
  { host: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1', outcome: 'pending' }, { host: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2', outcome: 'pending' },
  { host: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3', outcome: 'pending' }]);
const GPU_HOUSE_MEM_EDGE = gpuHouse([199.6, -49.6, 1e9, -80, NaN, '84'].map(function (t, i) {
  return gpuRow('gpubox', i, 'busy', { mem_temp: t });
}), [{ host: 'gpubox', outcome: 'ok' }]);
const GPU_HOUSE_MEM_NULL = gpuHouse([gpuRow('gpubox', 0, 'busy', { mem_temp: null }), gpuRow('gpubox', 1, 'busy'),
  gpuRow('gpubox', 2, 'busy', { mem_temp: 84 })], [{ host: 'gpubox', outcome: 'ok' }]);
const GPU_HOUSE_HOSTILE = gpuHouse([gpuRow(XSS, 0, 'busy', { name: XSS, mem_temp: XSS }), gpuRow('gpubox', 1, XSS)],
  [{ host: XSS, outcome: 'pending' }, { host: 'gpubox', outcome: 'ok' }]);

/* Eight and nine GPUs on four hosts (the busy GPU screens). */
function gpuBusy(n) {
  const hosts = ['gpubox', 'devbox', 'buildbox', 'labbox'];
  const st = ['throttling', 'hot', 'busy', 'busy', 'idle', 'busy', 'idle', 'busy', 'idle'];
  return gpuHouse(Array.from({ length: n }, function (_, i) {
    return gpuRow(hosts[i % 4], Math.floor(i / 4), st[i], {
      temp: st[i] === 'hot' ? 87 : 50 + i * 3, mem_temp: i % 3 ? 70 + i : null, util: st[i] === 'idle' ? 0 : 40 + i * 6,
      procs: st[i] === 'idle' ? 0 : 1, name: i % 2 ? 'NVIDIA GeForce RTX 3090 Ti' : 'Tesla V100-PCIE-32GB' });
  }), hosts.map(function (h) { return { host: h, outcome: 'ok' }; }));
}
const GPU_HOUSE_BUSY = gpuBusy(8);
const GPU_HOUSE_BUSY9 = gpuBusy(9);

/* Six sessions, two asking for input with a message. */
const SESS_BUSY = sessionsFixture('ok', [
  { name: 'nfs2seredux-e0', project: 'nfs2seredux', state: 'waiting', since: NOW_S - 240, message: 'Claude needs your permission to use Bash', tokens: 8847279, agents: 0 },
  { name: 'site-config-77', project: 'chiketi', state: 'waiting', since: NOW_S - 90, message: 'Approve the dry run?', tokens: 1204511, agents: 1, tool: 'codex' },
  { name: 'kiosk-deploy-ef', project: 'kiosk-deploy', state: 'busy', since: NOW_S - 6, message: null, tokens: 4105932, agents: 2 },
  { name: 'tests-a1', project: 'chiketi', state: 'shell', since: NOW_S - 75, message: null, tokens: 23410, agents: 1 },
  { name: 'ai-fabric-5f', project: 'ai-fabric', state: 'idle', since: NOW_S - 10680, message: null, tokens: 148943157, agents: 0 },
  { name: 'home-b0', project: '~', state: 'idle', since: NOW_S - 25200, message: null, tokens: 1175947, agents: 0 },
]);

/* Every Kiosk screen calm: Home Lab nominal, nobody waiting, GPUs fine. */
const KIOSK_CALM = sessionsFixture('ok', FULL['sessions.list'].value.filter(function (s) { return s.state !== 'waiting'; }));

module.exports = { HL_BUSY, HL_UNKNOWN, GPU_HOUSE_BUSY, GPU_HOUSE_BUSY9, SESS_BUSY, KIOSK_CALM, GPU_HOUSE, GPU_HOUSE_TIES, GPU_HOUSE_NONE, GPU_HOUSE_INCOMPLETE, GPU_HOUSE_PENDING_WITH_ROWS,
                   GPU_HOUSE_INCOMPLETE_WITH_ROWS, GPU_HOUSE_STALE, GPU_HOUSE_STALE_EMPTY, GPU_HOUSE_SPARSE,
                   GPU_HOUSE_MIXED_POWER, GPU_HOUSE_ONE_OFFLINE, GPU_HOUSE_MANY, GPU_HOUSE_HOSTILE, GPU_HOUSE_OLD, GPU_HOUSE_LONG_HOSTS,
                   GPU_HOUSE_MEM_EDGE, GPU_HOUSE_MEM_NULL,
                   KIOSK_EMPTY, HL_YELLOW, HL_RED, HL_STALE, HL_PENDING, HL_UNCONFIGURED, HL_HOSTILE,
                   SESS_EMPTY, SESS_MANY, SESS_OFFLINE, SESS_PENDING, SESS_UNCONFIGURED, SESS_HOSTILE,
                   FULL, EMPTY, UNAVAILABLE, NULL_VALUES, LARGE_DISK, HOSTILE, OLLAMA,
                   GPU_NONE, GPU_DUAL, GPU_QUAD, GPU_MANY, GPU_SPARSE,
                   GPU_HOSTILE, GPU_MALFORMED, GPU_IDLE };
