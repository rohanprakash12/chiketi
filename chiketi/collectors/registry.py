"""Platform-aware collector selection."""

from __future__ import annotations

from chiketi.collectors.base import MetricCollector
from chiketi.collectors.cpu import CpuCollector
from chiketi.collectors.memory import MemoryCollector
from chiketi.collectors.disk import DiskCollector
from chiketi.collectors.network import NetworkCollector
from chiketi.collectors.system import SystemCollector
from chiketi.collectors.gpu_nvidia import GpuNvidiaCollector
from chiketi.collectors.llm import LlmCollector
from chiketi.collectors.claude import ClaudeCollector


def get_collectors() -> list[MetricCollector]:
    """Return list of collectors appropriate for the current platform."""
    collectors: list[MetricCollector] = [
        SystemCollector(),
        MemoryCollector(),
        CpuCollector(),
        DiskCollector(),
        NetworkCollector(),
    ]

    # GPU - nvidia (no-ops when NVML is unavailable)
    collectors.append(GpuNvidiaCollector())

    # LLM backend (auto-detects llama.cpp, Ollama, vLLM)
    collectors.append(LlmCollector())

    # Claude Code usage stats
    collectors.append(ClaudeCollector())

    return collectors
