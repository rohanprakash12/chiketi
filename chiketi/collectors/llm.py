"""Generic LLM backend collector — supports llama.cpp, Ollama, and vLLM."""

from __future__ import annotations

import json
import re
import time
import urllib.request

import psutil

from chiketi.collectors.base import MetricCollector, MetricValue

# Default ports for each backend
_DEFAULTS = {
    "llama_cpp": {"port": 8080},
    "ollama": {"port": 11434},
    "vllm": {"port": 8000},
}

# Process name patterns for auto-detection
_PROC_PATTERNS = {
    "llama_cpp": ("llama-server", "llama_server"),
    "ollama": ("ollama",),
    "vllm": ("vllm",),
}

_QUANT_RE = re.compile(r"[_-](Q\d\w*(?:_[A-Z0-9]+)*)\b", re.IGNORECASE)


def _extract_quant(filename: str) -> str | None:
    """Extract quant tag from a GGUF model filename."""
    m = _QUANT_RE.search(filename)
    return m.group(1) if m else None


def _http_get_json(url: str, timeout: float = 2) -> dict | list | None:
    """GET a URL and return parsed JSON, or None on failure."""
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return json.loads(resp.read())
    except Exception:
        pass
    return None


class LlmCollector(MetricCollector):
    """Collects metrics from whichever LLM backend is running.

    Keeps the 'llama' namespace for backward compatibility with all
    screen renderers that reference m('llama.*') keys.
    """

    namespace = "llama"

    def __init__(self) -> None:
        super().__init__()
        self._backend: str | None = None
        self._backend_check_time: float = 0.0
        # For passive tok/sec tracking (llama.cpp)
        self._prev_decoded: dict[int, int] = {}
        self._prev_time: float = 0.0
        self._last_tok_sec: float | None = None

    def collect(self) -> dict[str, MetricValue]:
        backend = self._detect_backend()
        if backend == "llama_cpp":
            return self._collect_llama_cpp()
        if backend == "ollama":
            return self._collect_ollama()
        if backend == "vllm":
            return self._collect_vllm()
        return self._stopped_metrics()

    # ------------------------------------------------------------------
    # Backend detection
    # ------------------------------------------------------------------

    def _detect_backend(self) -> str | None:
        """Detect which LLM backend is running. Cache result (incl. None) for 10s.

        Caching the negative result matters: with no backend running, every
        collect cycle would otherwise repeat a full process scan plus three
        HTTP probes (each up to a 1s timeout).
        """
        now = time.monotonic()
        # _backend_check_time == 0.0 means "never checked yet".
        if self._backend_check_time and (now - self._backend_check_time) < 10:
            return self._backend

        # Check by process name first (fast)
        try:
            running_names: set[str] = set()
            for proc in psutil.process_iter(["name"]):
                n = (proc.info.get("name") or "").lower()
                if n:
                    running_names.add(n)
        except Exception:
            running_names = set()

        for backend, patterns in _PROC_PATTERNS.items():
            for pat in patterns:
                if any(pat in n for n in running_names):
                    self._backend = backend
                    self._backend_check_time = now
                    return backend

        # If no process found, try HTTP probes
        probes = [
            ("llama_cpp", f"http://localhost:{_DEFAULTS['llama_cpp']['port']}/health"),
            ("ollama", f"http://localhost:{_DEFAULTS['ollama']['port']}/api/tags"),
            ("vllm", f"http://localhost:{_DEFAULTS['vllm']['port']}/v1/models"),
        ]
        for backend, url in probes:
            if _http_get_json(url, timeout=1) is not None:
                self._backend = backend
                self._backend_check_time = now
                return backend

        self._backend = None
        self._backend_check_time = now
        return None

    # ------------------------------------------------------------------
    # Stopped fallback
    # ------------------------------------------------------------------

    def _stopped_metrics(self) -> dict[str, MetricValue]:
        return {
            self._key("status"): MetricValue(value="Stopped"),
            self._key("backend"): MetricValue(value="none"),
        }

    # ------------------------------------------------------------------
    # llama.cpp collection (original logic preserved)
    # ------------------------------------------------------------------

    def _collect_llama_cpp(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}
        port = _DEFAULTS["llama_cpp"]["port"]

        # Detect llama-server processes
        procs: list[dict] = []
        try:
            for proc in psutil.process_iter(["pid", "name", "cmdline"]):
                name = proc.info.get("name") or ""
                if "llama-server" in name or "llama_server" in name:
                    cmdline = proc.info.get("cmdline") or []
                    model = None
                    for i, arg in enumerate(cmdline):
                        if arg in ("-m", "--model") and i + 1 < len(cmdline):
                            model = cmdline[i + 1].rsplit("/", 1)[-1]
                            break
                    procs.append({"pid": proc.info["pid"], "model": model})
        except Exception:
            pass

        running = len(procs) > 0
        metrics[self._key("status")] = MetricValue(
            value="Running" if running else "Stopped"
        )
        metrics[self._key("backend")] = MetricValue(value="llama.cpp")
        metrics[self._key("processes")] = MetricValue(
            value=procs, extra={"count": len(procs)}
        )

        if running:
            # Health endpoint
            health = _http_get_json(f"http://localhost:{port}/health")
            if health and isinstance(health, dict):
                metrics[self._key("health")] = MetricValue(
                    value=health.get("status", "unknown")
                )
            else:
                metrics[self._key("health")] = MetricValue(value="no response")

            # Slots endpoint
            slots = _http_get_json(f"http://localhost:{port}/slots")
            if isinstance(slots, list):
                active = [s for s in slots if s.get("state") != 0]
                metrics[self._key("active_slots")] = MetricValue(
                    value=len(active), extra={"total": len(slots)}
                )
                if slots and "n_ctx" in slots[0]:
                    metrics[self._key("context")] = MetricValue(
                        value=slots[0]["n_ctx"]
                    )

                # Tokens per second
                tok_sec: float | None = None
                for s in slots:
                    for key in (
                        "predicted_per_second",
                        "t_token_generation_per_second",
                    ):
                        val = s.get(key)
                        if val is not None and val > 0:
                            tok_sec = val
                            break
                    if tok_sec is not None:
                        break

                # Passive tok/sec fallback
                if tok_sec is None:
                    now = time.monotonic()
                    dt = now - self._prev_time if self._prev_time else 0
                    cur_decoded: dict[int, int] = {}
                    total_new_tokens = 0
                    for s in slots:
                        sid = s.get("id", 0)
                        nd = 0
                        nt = s.get("next_token")
                        if isinstance(nt, list) and nt:
                            nd = nt[0].get("n_decoded", 0)
                        cur_decoded[sid] = nd
                        if dt > 0 and sid in self._prev_decoded:
                            delta = nd - self._prev_decoded[sid]
                            if delta > 0:
                                total_new_tokens += delta
                    self._prev_decoded = cur_decoded
                    self._prev_time = now
                    if dt > 0.5 and total_new_tokens > 0:
                        tok_sec = total_new_tokens / dt
                        self._last_tok_sec = tok_sec
                    elif self._last_tok_sec is not None:
                        tok_sec = self._last_tok_sec

                if tok_sec is not None:
                    metrics[self._key("tok_per_sec")] = MetricValue(
                        value=round(tok_sec, 1), unit="t/s"
                    )

        # Model name and quant from process args
        if procs and procs[0].get("model"):
            model_file = procs[0]["model"]
            metrics[self._key("model")] = MetricValue(value=model_file)
            quant = _extract_quant(model_file)
            if quant:
                metrics[self._key("quant")] = MetricValue(value=quant)

        return metrics

    # ------------------------------------------------------------------
    # Ollama collection
    # ------------------------------------------------------------------

    def _collect_ollama(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}
        port = _DEFAULTS["ollama"]["port"]
        base = f"http://localhost:{port}"

        metrics[self._key("backend")] = MetricValue(value="ollama")

        # Check running models via /api/ps
        ps_data = _http_get_json(f"{base}/api/ps")
        models_running: list[dict] = []
        if isinstance(ps_data, dict):
            models_running = ps_data.get("models", [])

        if models_running:
            metrics[self._key("status")] = MetricValue(value="Running")
            metrics[self._key("health")] = MetricValue(value="ok")

            model_info = models_running[0]
            model_name = model_info.get("model", "")
            metrics[self._key("model")] = MetricValue(value=model_name)

            # Extract quant from model details if available
            details = model_info.get("details", {})
            quant = details.get("quantization_level", "")
            if quant:
                metrics[self._key("quant")] = MetricValue(value=quant)

            # Context size from model size_vram or details
            size_vram = model_info.get("size_vram", 0)
            if size_vram:
                metrics[self._key("context")] = MetricValue(
                    value=f"{size_vram // (1024*1024)}MB VRAM"
                )
        else:
            # Ollama running but no models loaded
            tags = _http_get_json(f"{base}/api/tags")
            if tags is not None:
                metrics[self._key("status")] = MetricValue(value="Idle")
                metrics[self._key("health")] = MetricValue(value="ok")
            else:
                metrics[self._key("status")] = MetricValue(value="Stopped")
                metrics[self._key("health")] = MetricValue(value="no response")

        return metrics

    # ------------------------------------------------------------------
    # vLLM collection (OpenAI-compatible API)
    # ------------------------------------------------------------------

    def _collect_vllm(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}
        port = _DEFAULTS["vllm"]["port"]
        base = f"http://localhost:{port}"

        metrics[self._key("backend")] = MetricValue(value="vllm")

        # /v1/models endpoint
        models_data = _http_get_json(f"{base}/v1/models")
        if isinstance(models_data, dict):
            model_list = models_data.get("data", [])
            if model_list:
                metrics[self._key("status")] = MetricValue(value="Running")
                metrics[self._key("health")] = MetricValue(value="ok")
                model_id = model_list[0].get("id", "")
                metrics[self._key("model")] = MetricValue(value=model_id)
            else:
                metrics[self._key("status")] = MetricValue(value="Idle")
                metrics[self._key("health")] = MetricValue(value="ok")
        else:
            metrics[self._key("status")] = MetricValue(value="Stopped")
            metrics[self._key("health")] = MetricValue(value="no response")

        return metrics
