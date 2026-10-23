"""Platform-aware collector selection."""

from __future__ import annotations

from chiketi.collectors.base import MetricCollector
from chiketi.collectors.claude import ClaudeCollector
from chiketi.collectors.cpu import CpuCollector
from chiketi.collectors.disk import DiskCollector
from chiketi.collectors.gpu import GpuCollector
from chiketi.collectors.homelab import HomelabCollector
from chiketi.collectors.llm import LlmCollector
from chiketi.collectors.memory import MemoryCollector
from chiketi.collectors.network import NetworkCollector
from chiketi.collectors.ping import PingCollector
from chiketi.collectors.sessions import SessionsCollector
from chiketi.collectors.system import SystemCollector


def get_collectors() -> list[MetricCollector]:
    """Return list of collectors appropriate for the current platform."""
    collectors: list[MetricCollector] = [
        SystemCollector(),
        MemoryCollector(),
        CpuCollector(),
        DiskCollector(),
        NetworkCollector(),
        PingCollector(),
    ]

    # GPU - NVIDIA via NVML, AMD/Intel via sysfs, merged.
    # No-ops when the machine has no card either source can see.
    collectors.append(GpuCollector())

    # LLM backend (auto-detects llama.cpp, Ollama, vLLM)
    collectors.append(LlmCollector())

    # Claude Code usage stats
    collectors.append(ClaudeCollector())

    # Live Claude Code sessions from a session feed. Inert (status
    # "unconfigured", no thread) unless ~/.config/chiketi/sessions.toml exists.
    collectors.append(SessionsCollector())

    # Home Lab health board. Inert (status "unconfigured", no thread) unless
    # ~/.config/chiketi/homelab.toml exists.
    collectors.append(HomelabCollector())

    return collectors
