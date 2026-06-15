"""Tests for pure formatting helpers in the collector modules."""

from __future__ import annotations

from chiketi.collectors.disk import _gib as disk_gib, _tib
from chiketi.collectors.llm import _extract_quant
from chiketi.collectors.memory import _gib as mem_gib
from chiketi.collectors.network import _format_rate


class TestMemoryGib:
    def test_one_gib(self):
        assert mem_gib(1024**3) == 1.0

    def test_rounds_one_decimal(self):
        # 1.5 GiB
        assert mem_gib(int(1.5 * 1024**3)) == 1.5

    def test_zero(self):
        assert mem_gib(0) == 0.0


class TestDiskGibTib:
    def test_gib(self):
        assert disk_gib(1024**3) == 1.0

    def test_tib_two_decimals(self):
        assert _tib(1024**4) == 1.0
        assert _tib(int(2.5 * 1024**4)) == 2.5

    def test_tib_rounding(self):
        # 1.234 TiB -> rounds to 1.23
        val = _tib(int(1.234 * 1024**4))
        assert val == 1.23


class TestFormatRate:
    def test_bytes(self):
        val, unit = _format_rate(500)
        assert unit == "B/s"
        assert val == "500"

    def test_kilobytes(self):
        val, unit = _format_rate(1500)
        assert unit == "KB/s"
        assert val == "1.5"

    def test_megabytes(self):
        val, unit = _format_rate(2_500_000)
        assert unit == "MB/s"
        assert val == "2.5"

    def test_boundary_one_kb(self):
        val, unit = _format_rate(1000)
        assert unit == "KB/s"

    def test_boundary_one_mb(self):
        val, unit = _format_rate(1_000_000)
        assert unit == "MB/s"

    def test_returns_parseable_float(self):
        val, _ = _format_rate(1_500_000)
        assert float(val) == 1.5


class TestExtractQuant:
    def test_basic_quant(self):
        assert _extract_quant("model-Q4_K_M.gguf") == "Q4_K_M"

    def test_underscore_separator(self):
        assert _extract_quant("llama_Q8_0.gguf") == "Q8_0"

    def test_no_quant(self):
        assert _extract_quant("plain-model.gguf") is None

    def test_q5(self):
        assert _extract_quant("foo-Q5_K_S.gguf") == "Q5_K_S"

    def test_case_insensitive(self):
        # regex is IGNORECASE; lowercase q4 still matches
        assert _extract_quant("model-q4_0.gguf") == "q4_0"
