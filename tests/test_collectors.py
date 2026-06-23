"""Collector tests with psutil / nvml / HTTP mocked. Fully headless."""

from __future__ import annotations

from types import SimpleNamespace
from unittest import mock


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
        counters = SimpleNamespace(bytes_sent=1000, bytes_recv=2000)
        with mock.patch.object(net_mod, "_get_primary_ip", return_value="1.2.3.4"), \
             mock.patch.object(net_mod, "_get_iface_for_ip", return_value="eth0"), \
             mock.patch.object(net_mod.psutil, "net_if_addrs", return_value=addrs), \
             mock.patch.object(net_mod.psutil, "net_if_stats",
                               return_value={"eth0": SimpleNamespace(speed=1000)}), \
             mock.patch.object(net_mod.psutil, "net_io_counters", return_value=counters):
            m = NetworkCollector().collect()
        assert m["net.ip"].value == "1.2.3.4"
        assert m["net.speed"].value == 1000
        assert m["net.dl"].value == 0.0
        assert m["net.ul"].value == 0.0

    def test_second_collect_computes_rate(self):
        c1 = SimpleNamespace(bytes_sent=0, bytes_recv=0)
        c2 = SimpleNamespace(bytes_sent=1_000_000, bytes_recv=2_000_000)
        col = NetworkCollector()
        with mock.patch.object(net_mod, "_get_primary_ip", return_value=None), \
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
        import chiketi.collectors.claude as claude_mod
        empty = tmp_path / "projects"
        empty.mkdir()
        with mock.patch.object(claude_mod, "_PROJECTS_DIR", str(empty)):
            m = ClaudeCollector().collect()
        assert m["claude.tokens_total"].value == 0
        assert m["claude.sessions"].value == 0
        assert m["claude.days_active"].value == 1
        assert isinstance(m["claude.sparkline"].value, list)
