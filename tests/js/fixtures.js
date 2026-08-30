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
  'disk.root_used': mval(120.5, 'GiB', { total: 500.0, percent: 24.1 }),
  'disk.root_total': mval(500.0, 'GiB'),
  'disk.root_percent': mval(24.1, '%'),
  'disk.home_used': mval(300.0, 'GiB', { total: 900.0, percent: 33.3 }),
  'disk.home_total': mval(900.0, 'GiB'),
  'disk.home_percent': mval(33.3, '%'),
  'net.ip': mval('192.168.16.66'),
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
const XSS = '<img src=x onerror=alert(1)>';
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
      ? { value: '<img src=x onerror=alert(1)>', unit: v.unit, available: true, extra: v.extra }
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

module.exports = { FULL, EMPTY, UNAVAILABLE, NULL_VALUES, LARGE_DISK, HOSTILE, OLLAMA,
                   GPU_NONE, GPU_DUAL, GPU_QUAD, GPU_MANY, GPU_SPARSE,
                   GPU_HOSTILE, GPU_MALFORMED, GPU_IDLE };
