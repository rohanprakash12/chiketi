"""Collector tests with psutil / nvml / HTTP mocked. Fully headless."""

from __future__ import annotations

import json
import os
import time
from types import SimpleNamespace
from unittest import mock

import pytest


import chiketi.collectors.claude as claude_mod
import chiketi.collectors.cpu as cpu_mod
import chiketi.collectors.disk as disk_mod
import chiketi.collectors.gpu_nvidia as gpu_mod
import chiketi.collectors.llm as llm_mod
import chiketi.collectors.memory as mem_mod
import chiketi.collectors.network as net_mod
import chiketi.collectors.system as sys_mod
from chiketi.collectors.claude import ClaudeCollector
from chiketi.collectors.cpu import CpuCollector
from chiketi.collectors.disk import DiskCollector
from chiketi.collectors.gpu_nvidia import GpuNvidiaCollector
from chiketi.collectors.llm import LlmCollector
from chiketi.collectors.memory import MemoryCollector
from chiketi.collectors.network import NetworkCollector
from chiketi.collectors.system import SystemCollector


class TestMemoryCollector:
    def test_normal(self):
        vm = SimpleNamespace(total=16 * 1024**3, used=8 * 1024**3, percent=50.0)
        sw = SimpleNamespace(total=2 * 1024**3, used=1 * 1024**3, percent=50.0)
        with mock.patch.object(mem_mod.psutil, "virtual_memory", return_value=vm), \
             mock.patch.object(mem_mod.psutil, "swap_memory", return_value=sw):
            m = MemoryCollector().collect()
        assert m["mem.ram_total"].value == 16.0
        assert m["mem.ram_used"].value == 8.0
        assert m["mem.ram_percent"].value == 50.0
        assert m["mem.ram_used"].extra["total"] == 16.0
        assert m["mem.swap_percent"].value == 50.0

    def test_exception_marks_unavailable(self):
        with mock.patch.object(mem_mod.psutil, "virtual_memory", side_effect=OSError), \
             mock.patch.object(mem_mod.psutil, "swap_memory", side_effect=OSError):
            m = MemoryCollector().collect()
        assert m["mem.ram_used"].available is False
        assert m["mem.swap_used"].available is False


class TestDiskCollector:
    def test_gib_branch(self):
        usage = SimpleNamespace(total=500 * 1024**3, used=250 * 1024**3, percent=50.0)
        with mock.patch.object(disk_mod.psutil, "disk_usage", return_value=usage):
            m = DiskCollector().collect()
        assert m["disk.root_total"].unit == "GiB"
        assert m["disk.root_used"].value == 250.0
        assert m["disk.root_percent"].value == 50.0

    def test_tib_branch(self):
        usage = SimpleNamespace(total=2 * 1024**4, used=1 * 1024**4, percent=50.0)
        with mock.patch.object(disk_mod.psutil, "disk_usage", return_value=usage):
            m = DiskCollector().collect()
        assert m["disk.root_total"].unit == "TiB"
        assert m["disk.root_total"].value == 2.0

    def test_exception(self):
        with mock.patch.object(disk_mod.psutil, "disk_usage", side_effect=OSError):
            m = DiskCollector().collect()
        assert m["disk.root_used"].available is False
        assert m["disk.home_used"].available is False


class TestCpuCollector:
    def _patch_sensors(self, stack):
        stack.enter_context(mock.patch.object(
            cpu_mod.psutil, "sensors_temperatures", return_value={}, create=True))
        stack.enter_context(mock.patch.object(
            cpu_mod.psutil, "sensors_fans", return_value={}, create=True))

    def test_usage_and_per_core(self):
        import contextlib
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "cpu_percent",
                side_effect=lambda interval=None, percpu=False:
                    [10.0, 20.0] if percpu else 30.0))
            self._patch_sensors(stack)
            m = CpuCollector().collect()
        assert m["cpu.usage"].value == 30.0
        assert m["cpu.per_core"].value == [10.0, 20.0]

    def test_temp_from_coretemp(self):
        import contextlib
        temps = {"coretemp": [SimpleNamespace(label="Core 0", current=55.4)]}
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "cpu_percent", return_value=5.0))
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "sensors_temperatures", return_value=temps, create=True))
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "sensors_fans", return_value={}, create=True))
            m = CpuCollector().collect()
        assert m["cpu.temp"].value == 55
        assert m["cpu.temp"].unit == "°C"

    def test_sensors_temperatures_read_once(self):
        """It is a full sysfs walk; CPU and MB temps must share one read."""
        import contextlib
        temps = {
            "coretemp": [SimpleNamespace(label="Core 0", current=55.4)],
            "acpitz": [SimpleNamespace(label="SYSTIN", current=38.2)],
        }
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "cpu_percent", return_value=5.0))
            st = stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "sensors_temperatures", return_value=temps,
                create=True))
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "sensors_fans", return_value={}, create=True))
            m = CpuCollector().collect()
        assert st.call_count == 1
        assert m["cpu.temp"].value == 55
        assert m["cpu.mb_temp"].value == 38

    def test_sensors_temperatures_failure_degrades_both(self):
        import contextlib
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "cpu_percent", return_value=5.0))
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "sensors_temperatures", side_effect=OSError,
                create=True))
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "sensors_fans", return_value={}, create=True))
            m = CpuCollector().collect()
        assert m["cpu.temp"].available is False
        assert m["cpu.mb_temp"].available is False
        # The rest of the cycle must survive.
        assert m["cpu.usage"].value == 5.0

    def test_fans_classified(self):
        import contextlib
        fans = {"chip": [
            SimpleNamespace(label="cpu_fan", current=1200),
            SimpleNamespace(label="cpu_fan2", current=1100),
            SimpleNamespace(label="case_fan", current=800),
        ]}
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "cpu_percent", return_value=5.0))
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "sensors_temperatures", return_value={}, create=True))
            stack.enter_context(mock.patch.object(
                cpu_mod.psutil, "sensors_fans", return_value=fans, create=True))
            m = CpuCollector().collect()
        assert m["cpu.fans_cpu"].value == [1200, 1100]
        assert m["cpu.fans_case"].value == [800]
        assert m["cpu.fan_count"].value == 3
        assert m["cpu.fan"].value == 1200
        assert m["cpu.fan"].available is True


class TestSystemCollector:
    def test_hostname_and_uptime(self):
        with mock.patch.object(sys_mod.socket, "gethostname", return_value="testbox"), \
             mock.patch.object(sys_mod.psutil, "boot_time", return_value=0.0), \
             mock.patch.object(sys_mod.time, "time", return_value=90061.0):
            m = SystemCollector().collect()
        assert m["sys.hostname"].value == "testbox"
        # 90061s = 1d 1h 1m
        assert m["sys.uptime"].value == "1d 1h 1m"
        assert m["sys.uptime"].extra["seconds"] == 90061.0

    def test_uptime_exception(self):
        with mock.patch.object(sys_mod.socket, "gethostname", return_value="h"), \
             mock.patch.object(sys_mod.psutil, "boot_time", side_effect=OSError):
            m = SystemCollector().collect()
        assert m["sys.uptime"].available is False


class TestNetworkCollector:
    def test_first_collect_zero_rate(self):
        addrs = {"eth0": [SimpleNamespace(family=net_mod.socket.AF_INET, address="1.2.3.4")]}
        pernic = {"eth0": SimpleNamespace(bytes_sent=1000, bytes_recv=2000)}
        with mock.patch.object(net_mod, "_get_primary_ip", return_value="1.2.3.4"), \
             mock.patch.object(net_mod, "_get_iface_for_ip", return_value="eth0"), \
             mock.patch.object(net_mod.psutil, "net_if_addrs", return_value=addrs), \
             mock.patch.object(net_mod.psutil, "net_if_stats",
                               return_value={"eth0": SimpleNamespace(speed=1000)}), \
             mock.patch.object(net_mod.psutil, "net_io_counters", return_value=pernic):
            m = NetworkCollector().collect()
        assert m["net.ip"].value == "1.2.3.4"
        assert m["net.speed"].value == 1000
        assert m["net.dl"].value == 0.0
        assert m["net.ul"].value == 0.0
        # The first sample must still carry the extra key consumers read.
        assert m["net.dl"].extra["raw_bytes_per_sec"] == 0.0
        assert m["net.ul"].extra["raw_bytes_per_sec"] == 0.0

    def test_second_collect_computes_rate(self):
        addrs = {"eth0": [SimpleNamespace(family=net_mod.socket.AF_INET, address="1.2.3.4")]}
        c1 = {"eth0": SimpleNamespace(bytes_sent=0, bytes_recv=0)}
        c2 = {"eth0": SimpleNamespace(bytes_sent=1_000_000, bytes_recv=2_000_000)}
        col = NetworkCollector()
        with mock.patch.object(net_mod, "_get_primary_ip", return_value="1.2.3.4"), \
             mock.patch.object(net_mod.psutil, "net_if_addrs", return_value=addrs), \
             mock.patch.object(net_mod.psutil, "net_if_stats", return_value={}), \
             mock.patch.object(net_mod.psutil, "net_io_counters", side_effect=[c1, c2]), \
             mock.patch.object(net_mod.time, "monotonic", side_effect=[100.0, 101.0]):
            col.collect()
            m = col.collect()
        # 1s elapsed, 2_000_000 bytes recv -> 2.0 MB/s
        assert m["net.dl"].unit == "MB/s"
        assert m["net.dl"].value == 2.0
        assert m["net.ul"].value == 1.0

    def test_ip_exception_unavailable(self):
        with mock.patch.object(net_mod, "_get_primary_ip", side_effect=OSError), \
             mock.patch.object(net_mod.psutil, "net_io_counters", side_effect=OSError):
            m = NetworkCollector().collect()
        assert m["net.ip"].available is False
        assert m["net.dl"].available is False


class TestNetworkPerInterface:
    def test_uses_primary_interface_counters(self):
        c = NetworkCollector()
        pernic = {
            "eth0": SimpleNamespace(bytes_sent=1000, bytes_recv=2000),
            "docker0": SimpleNamespace(bytes_sent=999999, bytes_recv=999999),
        }
        with mock.patch.object(net_mod, "_get_primary_ip", return_value="10.0.0.5"), \
             mock.patch.object(net_mod, "_get_iface_for_ip", return_value="eth0"), \
             mock.patch.object(net_mod.psutil, "net_if_addrs", return_value={}), \
             mock.patch.object(net_mod.psutil, "net_if_stats", return_value={}), \
             mock.patch.object(net_mod.psutil, "net_io_counters",
                               return_value=pernic) as io, \
             mock.patch.object(net_mod.time, "monotonic", side_effect=[100.0, 101.0]):
            c.collect()
            pernic["eth0"] = SimpleNamespace(bytes_sent=1000, bytes_recv=2000 + 1_000_000)
            pernic["docker0"] = SimpleNamespace(bytes_sent=999999, bytes_recv=99_999_999)
            metrics = c.collect()
            io.assert_called_with(pernic=True)
        # docker0's huge delta must not appear in the primary link's rate.
        dl = metrics["net.dl"].extra["raw_bytes_per_sec"]
        assert dl == 1_000_000.0
        assert dl < 100_000_000

    def test_counter_reset_clamps_to_zero(self):
        c = NetworkCollector()
        pernic = {"eth0": SimpleNamespace(bytes_sent=5000, bytes_recv=9000)}
        with mock.patch.object(net_mod, "_get_primary_ip", return_value="10.0.0.5"), \
             mock.patch.object(net_mod, "_get_iface_for_ip", return_value="eth0"), \
             mock.patch.object(net_mod.psutil, "net_if_addrs", return_value={}), \
             mock.patch.object(net_mod.psutil, "net_if_stats", return_value={}), \
             mock.patch.object(net_mod.psutil, "net_io_counters", return_value=pernic), \
             mock.patch.object(net_mod.time, "monotonic", side_effect=[100.0, 101.0]):
            c.collect()
            pernic["eth0"] = SimpleNamespace(bytes_sent=10, bytes_recv=20)  # reset
            metrics = c.collect()
        assert metrics["net.dl"].extra["raw_bytes_per_sec"] == 0.0
        assert metrics["net.ul"].extra["raw_bytes_per_sec"] == 0.0

    def test_interface_change_resets_history(self):
        """A different NIC's counters are unrelated; do not diff across them."""
        c = NetworkCollector()
        pernic = {
            "eth0": SimpleNamespace(bytes_sent=1000, bytes_recv=2000),
            "wlan0": SimpleNamespace(bytes_sent=50, bytes_recv=60),
        }
        with mock.patch.object(net_mod, "_get_primary_ip", return_value="10.0.0.5"), \
             mock.patch.object(net_mod, "_get_iface_for_ip",
                               side_effect=["eth0", "wlan0"]), \
             mock.patch.object(net_mod.psutil, "net_if_addrs", return_value={}), \
             mock.patch.object(net_mod.psutil, "net_if_stats", return_value={}), \
             mock.patch.object(net_mod.psutil, "net_io_counters", return_value=pernic), \
             mock.patch.object(net_mod.time, "monotonic", side_effect=[100.0, 101.0]):
            c.collect()
            metrics = c.collect()
        assert metrics["net.dl"].extra["raw_bytes_per_sec"] == 0.0

    def test_falls_back_to_aggregate_without_primary_iface(self):
        agg = SimpleNamespace(bytes_sent=7, bytes_recv=9)
        c = NetworkCollector()

        def io(pernic=False):
            return {"lo": SimpleNamespace(bytes_sent=1, bytes_recv=1)} if pernic else agg

        with mock.patch.object(net_mod, "_get_primary_ip", return_value=None), \
             mock.patch.object(net_mod.psutil, "net_io_counters", side_effect=io), \
             mock.patch.object(net_mod.time, "monotonic", return_value=100.0):
            c.collect()
        assert c._prev_iface is None
        assert c._prev_bytes_recv == 9

    def test_single_net_if_addrs_call(self):
        addrs = {"eth0": [
            SimpleNamespace(family=net_mod.socket.AF_INET, address="1.2.3.4"),
            SimpleNamespace(family=net_mod.psutil.AF_LINK, address="aa:bb:cc:dd:ee:ff"),
        ]}
        pernic = {"eth0": SimpleNamespace(bytes_sent=1, bytes_recv=2)}
        with mock.patch.object(net_mod, "_get_primary_ip", return_value="1.2.3.4"), \
             mock.patch.object(net_mod.psutil, "net_if_addrs",
                               return_value=addrs) as addr_mock, \
             mock.patch.object(net_mod.psutil, "net_if_stats", return_value={}), \
             mock.patch.object(net_mod.psutil, "net_io_counters", return_value=pernic):
            m = NetworkCollector().collect()
        assert addr_mock.call_count == 1
        assert m["net.mac"].value == "AA:BB:CC:DD:EE:FF"


class TestGpuNvidiaCollector:
    def test_all_unavailable_helper(self):
        m = GpuNvidiaCollector()._all_unavailable({})
        for k in ("name", "temp", "fan", "power", "vram_used", "util", "clock_gpu"):
            assert m[f"gpu.{k}"].available is False
        assert m["gpu.processes"].value == []

    def test_collect_falls_back_when_nvml_unavailable(self):
        with mock.patch.object(gpu_mod, "_ensure_nvml", return_value=False):
            m = GpuNvidiaCollector().collect()
        assert m["gpu.name"].available is False
        assert m["gpu.temp"].available is False
        assert m["gpu.processes"].value == []


class TestLlmCollector:
    def test_stopped_when_no_backend(self):
        col = LlmCollector()
        with mock.patch.object(col, "_detect_backend", return_value=None):
            m = col.collect()
        assert m["llama.status"].value == "Stopped"
        assert m["llama.backend"].value == "none"

    def test_ollama_running(self):
        col = LlmCollector()
        ps_data = {"models": [{
            "model": "llama3:8b",
            "details": {"quantization_level": "Q4_K_M"},
            "size_vram": 5 * 1024 * 1024,
        }]}

        def fake_get(url, timeout=2):
            if url.endswith("/api/ps"):
                return ps_data
            return None

        with mock.patch.object(col, "_detect_backend", return_value="ollama"), \
             mock.patch.object(llm_mod, "_http_get_json", side_effect=fake_get):
            m = col.collect()
        assert m["llama.backend"].value == "ollama"
        assert m["llama.status"].value == "Running"
        assert m["llama.model"].value == "llama3:8b"
        assert m["llama.quant"].value == "Q4_K_M"

    def test_vllm_running(self):
        col = LlmCollector()
        models = {"data": [{"id": "mistral-7b"}]}
        with mock.patch.object(col, "_detect_backend", return_value="vllm"), \
             mock.patch.object(llm_mod, "_http_get_json", return_value=models):
            m = col.collect()
        assert m["llama.backend"].value == "vllm"
        assert m["llama.status"].value == "Running"
        assert m["llama.model"].value == "mistral-7b"

    def test_llama_cpp_running_with_model(self):
        col = LlmCollector()
        proc = SimpleNamespace(info={
            "pid": 42, "name": "llama-server",
            "cmdline": ["llama-server", "-m", "/models/foo-Q4_K_M.gguf"],
        })

        def fake_get(url, timeout=2):
            if url.endswith("/health"):
                return {"status": "ok"}
            if url.endswith("/slots"):
                return [{"state": 1, "n_ctx": 4096}]
            return None

        with mock.patch.object(col, "_detect_backend", return_value="llama_cpp"), \
             mock.patch.object(llm_mod.psutil, "process_iter", return_value=[proc]), \
             mock.patch.object(llm_mod, "_http_get_json", side_effect=fake_get):
            m = col.collect()
        assert m["llama.status"].value == "Running"
        assert m["llama.backend"].value == "llama.cpp"
        assert m["llama.model"].value == "foo-Q4_K_M.gguf"
        assert m["llama.quant"].value == "Q4_K_M"
        assert m["llama.context"].value == 4096


class _Clock:
    """Controllable monotonic clock for time-dependent collector logic."""

    def __init__(self, t: float = 1000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


class TestLlamaCppHttpDiscovery:
    def test_http_discovered_server_reports_running(self):
        """A responding /health means running even with no matching process."""
        col = LlmCollector()

        def fake_get(url, timeout=2):
            if url.endswith("/health"):
                return {"status": "ok"}
            if url.endswith("/slots"):
                return []
            return None

        with mock.patch.object(col, "_detect_backend", return_value="llama_cpp"), \
             mock.patch.object(llm_mod.psutil, "process_iter", return_value=iter([])), \
             mock.patch.object(llm_mod, "_http_get_json", side_effect=fake_get):
            m = col.collect()
        assert m["llama.status"].value == "Running"
        assert m["llama.health"].value == "ok"
        assert m["llama.processes"].extra["count"] == 0
        # Telemetry must not be skipped either.
        assert m["llama.active_slots"].value == 0

    def test_no_process_and_no_http_reports_stopped(self):
        col = LlmCollector()
        with mock.patch.object(col, "_detect_backend", return_value="llama_cpp"), \
             mock.patch.object(llm_mod.psutil, "process_iter", return_value=iter([])), \
             mock.patch.object(llm_mod, "_http_get_json", return_value=None):
            m = col.collect()
        assert m["llama.status"].value == "Stopped"
        assert "llama.health" not in m

    def test_health_probed_once_per_collect(self):
        """The /health response is reused, not re-requested."""
        col = LlmCollector()
        proc = SimpleNamespace(info={"pid": 1, "name": "llama-server", "cmdline": []})

        def fake_get(url, timeout=2):
            return {"status": "ok"} if url.endswith("/health") else None

        with mock.patch.object(col, "_detect_backend", return_value="llama_cpp"), \
             mock.patch.object(llm_mod.psutil, "process_iter", return_value=iter([proc])), \
             mock.patch.object(llm_mod, "_http_get_json", side_effect=fake_get) as http:
            col.collect()
        health_calls = [c for c in http.call_args_list if c.args[0].endswith("/health")]
        assert len(health_calls) == 1


class TestLlamaProcessScanCache:
    def _proc(self):
        return SimpleNamespace(info={"pid": 1, "name": "llama-server", "cmdline": []})

    def test_process_scan_is_cached_across_collects(self):
        col = LlmCollector()
        clock = _Clock()
        with mock.patch.object(col, "_detect_backend", return_value="llama_cpp"), \
             mock.patch.object(llm_mod.time, "monotonic", clock), \
             mock.patch.object(llm_mod.psutil, "process_iter",
                               side_effect=lambda attrs: iter([self._proc()])) as pi, \
             mock.patch.object(llm_mod, "_http_get_json", return_value=None):
            for _ in range(5):
                col.collect()
                clock.advance(1.5)
        # 5 collects over 6s: one scan, not five.
        assert pi.call_count == 1

    def test_process_scan_cache_expires(self):
        col = LlmCollector()
        clock = _Clock()
        with mock.patch.object(col, "_detect_backend", return_value="llama_cpp"), \
             mock.patch.object(llm_mod.time, "monotonic", clock), \
             mock.patch.object(llm_mod.psutil, "process_iter",
                               side_effect=lambda attrs: iter([self._proc()])) as pi, \
             mock.patch.object(llm_mod, "_http_get_json", return_value=None):
            col.collect()
            clock.advance(5.0)
            col.collect()
            clock.advance(6.0)   # now 11s past the scan
            col.collect()
        assert pi.call_count == 2


class TestOllamaVram:
    def test_vram_not_reported_as_context(self):
        col = LlmCollector()
        payload = {"models": [{
            "model": "qwen3:32b",
            "size_vram": 21474836480,
            "details": {"quantization_level": "Q4_K_M"},
        }]}
        with mock.patch.object(col, "_detect_backend", return_value="ollama"), \
             mock.patch.object(llm_mod, "_http_get_json", return_value=payload):
            m = col.collect()
        assert "llama.context" not in m
        assert m["llama.vram"].value == 20480
        assert m["llama.vram"].unit == "MiB"

    def test_real_context_length_is_used_when_present(self):
        col = LlmCollector()
        payload = {"models": [{
            "model": "qwen3:32b",
            "size_vram": 1024 * 1024,
            "context_length": 40960,
            "details": {},
        }]}
        with mock.patch.object(col, "_detect_backend", return_value="ollama"), \
             mock.patch.object(llm_mod, "_http_get_json", return_value=payload):
            m = col.collect()
        assert m["llama.context"].value == 40960
        assert m["llama.vram"].value == 1


class TestTokSecStaleness:
    def test_stale_rate_expires(self):
        col = LlmCollector()
        col._last_tok_sec = 42.0
        col._last_tok_sec_time = time.monotonic() - 60  # a minute old
        assert col._fresh_tok_sec() is None

    def test_fresh_rate_is_returned(self):
        col = LlmCollector()
        col._note_tok_sec(42.0)
        assert col._fresh_tok_sec() == 42.0

    def test_unset_rate_is_none(self):
        assert LlmCollector()._fresh_tok_sec() is None

    def test_idle_server_stops_reporting_a_stale_rate(self):
        col = LlmCollector()
        clock = _Clock()
        decoded = {"n": 0}

        def fake_get(url, timeout=2):
            if url.endswith("/health"):
                return {"status": "ok"}
            if url.endswith("/slots"):
                return [{"state": 1, "id": 0,
                         "next_token": [{"n_decoded": decoded["n"]}]}]
            return None

        with mock.patch.object(col, "_detect_backend", return_value="llama_cpp"), \
             mock.patch.object(llm_mod.time, "monotonic", clock), \
             mock.patch.object(llm_mod.psutil, "process_iter", return_value=iter([])), \
             mock.patch.object(llm_mod, "_http_get_json", side_effect=fake_get):
            col.collect()                       # first sample, no rate yet
            clock.advance(1.0)
            decoded["n"] = 100
            m_busy = col.collect()              # 100 tokens in 1s
            clock.advance(2.0)                  # generation stopped
            m_recent = col.collect()
            clock.advance(30.0)                 # well past the 15s TTL
            m_idle = col.collect()

        assert m_busy["llama.tok_per_sec"].value == 100.0
        # Still smoothed over the short TTL...
        assert m_recent["llama.tok_per_sec"].value == 100.0
        # ...but never forever.
        assert "llama.tok_per_sec" not in m_idle


class TestClaudeCollector:
    def test_scan_file_accumulates(self, tmp_path):
        from tests.conftest import FIXTURES_DIR
        import os
        col = ClaudeCollector()
        totals = {
            "input": 0, "output": 0, "cache_write": 0, "cache_read": 0,
            "msgs_user": 0, "msgs_assistant": 0,
            "earliest": None, "latest": None, "session_count": 0,
        }
        col._scan_file(os.path.join(FIXTURES_DIR, "session.jsonl"), totals)
        assert totals["input"] == 300        # 100 + 200
        assert totals["output"] == 125        # 50 + 75
        assert totals["cache_write"] == 20
        assert totals["cache_read"] == 15     # 10 + 5
        assert totals["msgs_user"] == 2
        assert totals["msgs_assistant"] == 3  # incl. one with no usage
        assert totals["earliest"] is not None
        assert totals["latest"] is not None
        assert totals["latest"] > totals["earliest"]

    def test_scan_file_handles_missing_usage(self, tmp_path):
        col = ClaudeCollector()
        f = tmp_path / "s.jsonl"
        f.write_text('{"type": "assistant", "message": {}}\n')
        totals = {
            "input": 0, "output": 0, "cache_write": 0, "cache_read": 0,
            "msgs_user": 0, "msgs_assistant": 0,
            "earliest": None, "latest": None, "session_count": 0,
        }
        col._scan_file(str(f), totals)
        assert totals["msgs_assistant"] == 1
        assert totals["input"] == 0

    def test_collect_with_empty_projects(self, tmp_path):
        # Point the module at an empty projects dir so no real ~/.claude is read.
        empty = tmp_path / "projects"
        empty.mkdir()
        with mock.patch.object(claude_mod, "_PROJECTS_DIR", str(empty)):
            m = ClaudeCollector().collect()
        assert m["claude.tokens_total"].value == 0
        assert m["claude.sessions"].value == 0
        assert m["claude.days_active"].value == 1
        assert isinstance(m["claude.sparkline"].value, list)


class TestClaudeIncrementalRead:
    def _proj(self, tmp_path, monkeypatch):
        proj = tmp_path / "projects" / "p"
        proj.mkdir(parents=True)
        monkeypatch.setattr(claude_mod, "_PROJECTS_DIR", str(tmp_path / "projects"))
        return proj

    def test_partial_trailing_line_is_not_lost(self, tmp_path, monkeypatch):
        proj = self._proj(tmp_path, monkeypatch)
        f = proj / "s.jsonl"
        complete = json.dumps(
            {"type": "assistant", "message": {"usage": {"output_tokens": 10}}}
        )
        # The writer is mid-line: the second record has no trailing newline.
        f.write_text(complete + "\n" + '{"type": "assistant", "mess')
        c = ClaudeCollector()
        c._update_current_session()
        assert c._session_stats["output"] == 10
        # Now the writer finishes the line.
        f.write_text(complete + "\n" + json.dumps(
            {"type": "assistant", "message": {"usage": {"output_tokens": 7}}}) + "\n")
        c._update_current_session()
        assert c._session_stats["output"] == 17, "completed line was skipped"
        assert c._session_stats["msgs_assistant"] == 2

    def test_position_never_advances_past_a_fragment(self, tmp_path, monkeypatch):
        proj = self._proj(tmp_path, monkeypatch)
        f = proj / "s.jsonl"
        f.write_text('{"type": "user", "par')  # only a fragment, no newline
        c = ClaudeCollector()
        c._update_current_session()
        assert c._session_pos == 0
        assert c._session_stats["msgs_user"] == 0
        f.write_text('{"type": "user", "parentUuid": null}\n')
        c._update_current_session()
        assert c._session_stats["msgs_user"] == 1

    def test_truncation_resets_position(self, tmp_path, monkeypatch):
        proj = self._proj(tmp_path, monkeypatch)
        f = proj / "s.jsonl"
        line = json.dumps({"type": "user"}) + "\n"
        f.write_text(line * 10)
        c = ClaudeCollector()
        c._update_current_session()
        assert c._session_stats["msgs_user"] == 10
        f.write_text(line)  # truncated to one line
        c._update_current_session()
        assert c._session_stats["msgs_user"] == 1, "truncation not detected"

    def test_byte_offsets_survive_multibyte_content(self, tmp_path, monkeypatch):
        """A text handle's tell() is an opaque cookie; bytes must be used."""
        proj = self._proj(tmp_path, monkeypatch)
        f = proj / "s.jsonl"
        rec = json.dumps({"type": "user", "note": "日本語テキスト" * 20},
                         ensure_ascii=False) + "\n"
        f.write_text(rec, encoding="utf-8")
        c = ClaudeCollector()
        c._update_current_session()
        assert c._session_pos == len(rec.encode("utf-8"))
        assert c._session_stats["msgs_user"] == 1
        f.write_text(rec + rec, encoding="utf-8")
        c._update_current_session()
        assert c._session_stats["msgs_user"] == 2

    def test_malformed_records_do_not_stall_the_reader(self, tmp_path, monkeypatch):
        """A bad line must be skipped, not wedge _session_pos forever."""
        proj = self._proj(tmp_path, monkeypatch)
        f = proj / "s.jsonl"
        deep = "[" * 5000 + "]" * 5000           # RecursionError in json.loads
        good = json.dumps({"type": "user"})
        f.write_text("\n".join([good, deep, "42", "not json", good]) + "\n")
        c = ClaudeCollector()
        c._update_current_session()
        assert c._session_stats["msgs_user"] == 2
        assert c._session_pos == len(f.read_text().encode("utf-8"))

    def test_session_switch_emits_no_negative_rate(self, tmp_path, monkeypatch):
        proj = self._proj(tmp_path, monkeypatch)
        big = json.dumps(
            {"type": "assistant", "message": {"usage": {"output_tokens": 100000}}}
        ) + "\n"
        small = json.dumps(
            {"type": "assistant", "message": {"usage": {"output_tokens": 10}}}
        ) + "\n"
        a = proj / "a.jsonl"
        a.write_text(big * 5)
        os.utime(a, (1000, 1000))

        clock = _Clock()
        col = ClaudeCollector()
        with mock.patch.object(claude_mod.time, "monotonic", clock):
            col.collect()
            assert col._session_stats["output"] == 500000
            clock.advance(2.0)
            b = proj / "b.jsonl"
            b.write_text(small)
            os.utime(b, (2000, 2000))   # strictly newer than a.jsonl
            col.collect()
            assert col._session_stats["output"] == 10
            clock.advance(2.0)
            m = col.collect()
        assert all(x >= 0 for x in col._rate_samples), list(col._rate_samples)
        assert m["claude.token_rate"].value >= 0
        assert all(x >= 0 for x in m["claude.sparkline"].value)


class TestClaudeScanFileResilience:
    """One malformed record must never cost a whole file's stats.

    _scan_file's result is cached against (mtime, size), so a mid-file abort
    caches the partial totals -- a silent, permanent undercount that survives
    until the file changes again.
    """

    def _proj(self, tmp_path, monkeypatch):
        proj = tmp_path / "projects" / "p"
        proj.mkdir(parents=True)
        monkeypatch.setattr(claude_mod, "_PROJECTS_DIR", str(tmp_path / "projects"))
        return proj

    def _rec(self, out):
        return json.dumps(
            {"type": "assistant", "message": {"usage": {"output_tokens": out}}}
        )

    def test_non_string_timestamp_costs_only_that_record(self, tmp_path, monkeypatch):
        """A truthy non-string timestamp raises AttributeError on .replace."""
        proj = self._proj(tmp_path, monkeypatch)
        bad = json.dumps({"type": "assistant", "timestamp": 12345,
                          "message": {"usage": {"output_tokens": 5}}})
        (proj / "s.jsonl").write_text(
            self._rec(10) + "\n" + bad + "\n" + self._rec(7) + "\n"
        )
        totals = ClaudeCollector()._scan_all_sessions()
        # 10 + 5 + 7: the bad record's tokens still count, only its timestamp
        # is discarded. What must not happen is the file aborting at 10.
        assert totals["output"] == 22, "records after a bad timestamp were lost"

    def test_invalid_utf8_costs_only_that_line(self, tmp_path, monkeypatch):
        """Strict UTF-8 raises from the line iterator, outside per-line guards."""
        proj = self._proj(tmp_path, monkeypatch)
        blob = (
            self._rec(10).encode() + b"\n"
            + b'{"type":"assistant","x":"\xff\xfe"}\n'
            + self._rec(7).encode() + b"\n"
        )
        (proj / "s.jsonl").write_bytes(blob)
        totals = ClaudeCollector()._scan_all_sessions()
        assert totals["output"] == 17, "a bad byte zeroed the whole file"

    def test_bare_scalar_record_costs_only_that_line(self, tmp_path, monkeypatch):
        proj = self._proj(tmp_path, monkeypatch)
        (proj / "s.jsonl").write_text(
            self._rec(10) + "\n42\n" + self._rec(7) + "\n"
        )
        totals = ClaudeCollector()._scan_all_sessions()
        assert totals["output"] == 17

    def test_dangling_symlink_does_not_freeze_session_metrics(
        self, tmp_path, monkeypatch
    ):
        """A dangling *.jsonl symlink must be skipped, not abort the cycle.

        Aborting freezes session_*, agents_active, token_rate and sparkline
        forever, silently, for as long as the symlink exists.
        """
        proj = self._proj(tmp_path, monkeypatch)
        real = proj / "s.jsonl"
        real.write_text(self._rec(10) + "\n")
        (proj / "dangling.jsonl").symlink_to(tmp_path / "nonexistent")
        c = ClaudeCollector()
        c._update_current_session()
        assert c._session_stats["output"] == 10, "dangling symlink aborted the scan"
        with real.open("a") as fh:
            fh.write(self._rec(7) + "\n")
        c._update_current_session()
        assert c._session_stats["output"] == 17, "session metrics froze"


class TestClaudeCrossFileAggregation:
    """Cross-file min/max runs outside every per-record guard.

    A naive-but-valid ISO timestamp parses fine and is cached in that file's
    stats, then raises TypeError when compared against an aware one from
    another file -- killing every claude.* metric on every cycle, permanently,
    because the poison value is served from _file_cache.
    """

    def _proj(self, tmp_path, monkeypatch):
        proj = tmp_path / "projects" / "p"
        proj.mkdir(parents=True)
        monkeypatch.setattr(claude_mod, "_PROJECTS_DIR", str(tmp_path / "projects"))
        return proj

    def _rec(self, out, ts):
        return json.dumps({
            "type": "assistant", "timestamp": ts,
            "message": {"usage": {"output_tokens": out}},
        })

    def test_naive_and_aware_timestamps_across_files(self, tmp_path, monkeypatch):
        proj = self._proj(tmp_path, monkeypatch)
        (proj / "a.jsonl").write_text(self._rec(10, "2026-01-01T00:00:00Z") + "\n")
        (proj / "b.jsonl").write_text(self._rec(7, "2026-01-02T00:00:00") + "\n")
        c = ClaudeCollector()
        totals = c._scan_all_sessions()          # must not raise
        assert totals["output"] == 17
        assert totals["days_active"] >= 1
        metrics = c.collect()                    # must not raise
        assert metrics["claude.tokens_output"].value == 17

    def test_collect_survives_and_keeps_all_keys(self, tmp_path, monkeypatch):
        proj = self._proj(tmp_path, monkeypatch)
        (proj / "a.jsonl").write_text(self._rec(10, "2026-01-01T00:00:00Z") + "\n")
        (proj / "b.jsonl").write_text(self._rec(7, "2026-01-02T00:00:00") + "\n")
        metrics = ClaudeCollector().collect()
        assert len(metrics) == 21, "claude.* keys vanished"


class TestClaudeMalformedUsageShapes:
    """One bad-shaped record must cost only that record, in BOTH readers."""

    def _proj(self, tmp_path, monkeypatch):
        proj = tmp_path / "projects" / "p"
        proj.mkdir(parents=True)
        monkeypatch.setattr(claude_mod, "_PROJECTS_DIR", str(tmp_path / "projects"))
        return proj

    def _good(self, out):
        return json.dumps(
            {"type": "assistant", "message": {"usage": {"output_tokens": out}}}
        )

    BAD = [
        '{"type":"assistant","message":"hello"}',
        '{"type":"assistant","message":{"usage":7}}',
        '{"type":"assistant","message":{"usage":{"output_tokens":"x"}}}',
        '{"type":"assistant","message":{"usage":{"output_tokens":null}}}',
        '{"type":"assistant","message":null}',
        '{"type":"assistant","message":{"usage":[1,2]}}',
    ]

    @pytest.mark.parametrize("bad", BAD)
    def test_alltime_scanner_skips_only_the_bad_record(
        self, bad, tmp_path, monkeypatch
    ):
        proj = self._proj(tmp_path, monkeypatch)
        (proj / "s.jsonl").write_text(
            self._good(10) + "\n" + bad + "\n" + self._good(7) + "\n"
        )
        totals = ClaudeCollector()._scan_all_sessions()
        assert totals["output"] == 17, "records after a bad-shaped one were lost"
        assert totals["msgs_assistant"] == 3

    @pytest.mark.parametrize("bad", BAD)
    def test_session_reader_skips_only_the_bad_record(
        self, bad, tmp_path, monkeypatch
    ):
        proj = self._proj(tmp_path, monkeypatch)
        (proj / "s.jsonl").write_text(
            self._good(10) + "\n" + bad + "\n" + self._good(7) + "\n"
        )
        c = ClaudeCollector()
        c._update_current_session()
        assert c._session_stats["output"] == 17
        assert c._session_stats["msgs_assistant"] == 3
