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
  'net.speed': mval(1000, 'Mbps'),
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

module.exports = { FULL, EMPTY, UNAVAILABLE, NULL_VALUES, LARGE_DISK, HOSTILE };
