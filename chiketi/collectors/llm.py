"""Generic LLM backend collector — supports llama.cpp, Ollama, and vLLM."""

from __future__ import annotations

import json
import math
import re
import threading
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

# Untrusted-response limits. The backend endpoints are plain localhost HTTP:
# anything can bind those ports, so treat every response as hostile input.
_MAX_RESPONSE_BYTES = 1024 * 1024
_MAX_TEXT_CHARS = 512

_QUANT_RE = re.compile(r"[_-](Q\d\w*(?:_[A-Z0-9]+)*)\b", re.IGNORECASE)


def _extract_quant(filename: str) -> str | None:
    """Extract quant tag from a GGUF model filename."""
    m = _QUANT_RE.search(filename)
    return m.group(1) if m else None


def _dicts(value: object) -> list[dict]:
    """Keep only the dict entries of a JSON array; [] for anything else.

    Nothing on localhost:8080/11434/8000 is under our control -- any service
    squatting on those ports answers with whatever shape it likes, and every
    escaping exception costs a whole cycle of llama.* metrics.
    """
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _num(value: object) -> float | None:
    """Coerce a JSON scalar to a finite float, or None if it is not numeric.

    bool is rejected so JSON `true` does not silently become 1.0, and
    NaN/Infinity are rejected because json.loads accepts them literally and
    they serialise straight back out as invalid JSON the renderers print as
    "NaN".
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            num = float(value)
        except OverflowError:
            # A JSON integer of ~309+ digits cannot be represented as a float.
            # Python raises rather than returning inf (which is what the string
            # branch does), so this needs its own guard.
            return None
    elif isinstance(value, str):
        try:
            num = float(value.strip())
        except (ValueError, OverflowError):
            return None
    else:
        return None
    return num if math.isfinite(num) else None


def _int(value: object) -> int | None:
    """Coerce a JSON scalar to an int, or None if it is not numeric."""
    num = _num(value)
    return None if num is None else int(num)


def _text(value: object, default: str = "") -> str:
    """Flatten a JSON scalar to a string; containers become the default.

    A dict or list reaching a string-valued metric renders on the dashboard
    as "[object Object]".
    """
    if value is None:
        return default
    if isinstance(value, str):
        return value[:_MAX_TEXT_CHARS]
    if isinstance(value, (int, float, bool)):
        return str(value)[:_MAX_TEXT_CHARS]
    return default


# Abandoned in-flight requests, bounded. A slow-header attacker can make each
# request outlive its deadline, so refuse to start new ones past this many
# rather than accumulating threads for as long as the hostile service is up.
_MAX_INFLIGHT = 4
_inflight = threading.BoundedSemaphore(_MAX_INFLIGHT)


def _http_get_json(url: str, timeout: float = 2) -> dict | list | None:
    """GET a URL and return parsed JSON within `timeout`, or None.

    Runs the request on a daemon worker and abandons it at the deadline.
    urlopen() reads the status line and all headers BEFORE returning, bounded
    only by the per-socket-operation timeout -- so a server dribbling header
    bytes holds the call for time linear in the header size (measured 20.8s
    against a 2s timeout). No deadline inside the body loop can help, because
    control never reaches it. The collectors share one MetricEngine thread, so
    that freezes all 62 metrics, not just llama.*.

    The abandoned worker unwinds on its own once the peer stops feeding it.
    """
    if not _inflight.acquire(blocking=False):
        return None                      # too many already hung; skip this cycle
    box: list = []

    def _run() -> None:
        try:
            box.append(_http_get_json_blocking(url, timeout))
        except Exception:
            box.append(None)
        finally:
            _inflight.release()

    try:
        worker = threading.Thread(target=_run, daemon=True)
        worker.start()
    except Exception:
        # Thread.start() can raise under system-wide thread exhaustion, after
        # the permit is taken but before _run's finally can give it back.
        # Leaking it would permanently disable HTTP probing for the life of
        # the process once all four drained.
        _inflight.release()
        return None
    worker.join(timeout)
    return box[0] if box else None


def _http_get_json_blocking(url: str, timeout: float = 2) -> dict | list | None:
    """GET a URL and return parsed JSON, or None on failure.

    urlopen's timeout bounds each socket operation, not the whole response, so
    a server dripping one byte at a time keeps resetting it -- a measured 41s
    hang on a 21-byte body. The collectors run on a single MetricEngine
    thread, so that freezes every metric, not just llama.*. Read in bounded
    chunks against a wall-clock deadline, and cap the total so a fast
    multi-gigabyte body cannot exhaust memory either.
    """
    deadline = time.monotonic() + timeout
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            chunks: list[bytes] = []
            size = 0
            while size <= _MAX_RESPONSE_BYTES:
                if time.monotonic() > deadline:
                    return None
                want = min(65536, _MAX_RESPONSE_BYTES + 1 - size)
                # read1() returns as soon as ANY data is available; plain
                # read(n) blocks until it has all n bytes (or EOF), so a slow
                # server keeps the deadline check below from ever running.
                reader = getattr(resp, "read1", None)
                chunk = reader(want) if reader is not None else resp.read(want)
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
            else:
                return None          # hit the cap without EOF: oversized body
            return json.loads(b"".join(chunks))
    except Exception:
        pass
    return None


class LlmCollector(MetricCollector):
    """Collects metrics from whichever LLM backend is running.

    Keeps the 'llama' namespace for backward compatibility with all
    screen renderers that reference m('llama.*') keys.
    """

    namespace = "llama"

    # A cached generation rate is only meaningful for a short while after the
    # last observation; beyond this it is a stale number that never decays.
    _TOK_SEC_TTL_S = 15.0
    # Full process_iter(["pid","name","cmdline"]) walks measured ~86ms over
    # 276 processes. The collect cycle is 1.5s, so cache the result.
    _PROC_CACHE_TTL_S = 10.0

    def __init__(self) -> None:
        super().__init__()
        self._backend: str | None = None
        self._backend_check_time: float = 0.0
        # For passive tok/sec tracking (llama.cpp)
        self._prev_decoded: dict[int, int] = {}
        self._prev_time: float = 0.0
        self._last_tok_sec: float | None = None
        self._last_tok_sec_time: float = 0.0
        # llama-server process scan cache
        self._procs_cache: list[dict] = []
        self._procs_cache_time: float = 0.0

    def _fresh_tok_sec(self) -> float | None:
        """Return the cached token rate only while it is recent.

        Without this the last observed rate was reported forever after
        generation stopped, so an idle server showed a busy tok/s figure.
        """
        if self._last_tok_sec is None or not self._last_tok_sec_time:
            return None
        if (time.monotonic() - self._last_tok_sec_time) > self._TOK_SEC_TTL_S:
            return None
        return self._last_tok_sec

    def _note_tok_sec(self, value: float) -> None:
        """Record an observed generation rate together with its timestamp."""
        self._last_tok_sec = value
        self._last_tok_sec_time = time.monotonic()

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

    def _scan_llama_processes(self) -> list[dict]:
        """Walk every process looking for llama-server. Expensive; cached."""
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
                    # Keep the name as well as the model: the dashboards list
                    # these processes by name, and dropping it here left them
                    # printing "?" beside a real PID.
                    procs.append(
                        {"pid": proc.info["pid"], "name": name, "model": model}
                    )
        # Broad on purpose: process_iter can raise psutil.NoSuchProcess,
        # psutil.AccessDenied, OSError, or (on a /proc race) almost anything
        # mid-iteration. MetricCollector.collect() must never raise, and a
        # partial list beats losing every llama.* metric for this cycle.
        except Exception:
            pass
        return procs

    def _llama_processes(self) -> list[dict]:
        """Cached view of _scan_llama_processes()."""
        now = time.monotonic()
        # _procs_cache_time == 0.0 means "never scanned yet".
        if self._procs_cache_time and (now - self._procs_cache_time) < self._PROC_CACHE_TTL_S:
            return list(self._procs_cache)
        procs = self._scan_llama_processes()
        self._procs_cache = list(procs)
        self._procs_cache_time = now
        return procs

    def _collect_llama_cpp(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}
        port = _DEFAULTS["llama_cpp"]["port"]

        procs = self._llama_processes()

        # A backend can be discovered by HTTP probe alone (containerised
        # llama-server, a renamed binary, a reverse proxy). Treat a responding
        # /health endpoint as running: deriving `running` purely from the
        # process scan made such a server report "Stopped" and skipped every
        # telemetry call below.
        health = _http_get_json(f"http://localhost:{port}/health")
        http_alive = isinstance(health, dict)
        running = bool(procs) or http_alive

        metrics[self._key("status")] = MetricValue(
            value="Running" if running else "Stopped"
        )
        metrics[self._key("backend")] = MetricValue(value="llama.cpp")
        metrics[self._key("processes")] = MetricValue(
            value=procs, extra={"count": len(procs)}
        )

        if running:
            # Reuse the /health response fetched above rather than re-probing.
            if http_alive:
                metrics[self._key("health")] = MetricValue(
                    value=_text(health.get("status"), "unknown") or "unknown"
                )
            else:
                metrics[self._key("health")] = MetricValue(value="no response")

            # Slots endpoint
            slots = _http_get_json(f"http://localhost:{port}/slots")
            if isinstance(slots, list):
                # Only dict entries are usable; a list of strings or numbers
                # made `s.get(...)` raise AttributeError.
                slot_items = _dicts(slots)
                active = [s for s in slot_items if s.get("state") != 0]
                metrics[self._key("active_slots")] = MetricValue(
                    value=len(active), extra={"total": len(slot_items)}
                )
                if slot_items:
                    n_ctx = _int(slot_items[0].get("n_ctx"))
                    if n_ctx is not None:
                        metrics[self._key("context")] = MetricValue(value=n_ctx)

                # Tokens per second
                tok_sec: float | None = None
                for s in slot_items:
                    for key in (
                        "predicted_per_second",
                        "t_token_generation_per_second",
                    ):
                        # _num, not a bare `val > 0`: a string rate raised
                        # TypeError comparing str to int.
                        val = _num(s.get(key))
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
                    for s in slot_items:
                        sid = s.get("id", 0)
                        # A list/dict slot id is unhashable and blew up the
                        # cur_decoded[sid] assignment.
                        if not isinstance(sid, (int, str)):
                            continue
                        nd = 0
                        nt = s.get("next_token")
                        if isinstance(nt, list) and nt and isinstance(nt[0], dict):
                            nd = _int(nt[0].get("n_decoded")) or 0
                        cur_decoded[sid] = nd
                        if dt > 0 and sid in self._prev_decoded:
                            delta = nd - self._prev_decoded[sid]
                            if delta > 0:
                                total_new_tokens += delta
                    self._prev_decoded = cur_decoded
                    self._prev_time = now
                    if dt > 0.5 and total_new_tokens > 0:
                        tok_sec = total_new_tokens / dt
                        self._note_tok_sec(tok_sec)
                    else:
                        # Only reuse the cached rate while it is still fresh,
                        # otherwise an idle server keeps reporting the last
                        # busy figure indefinitely.
                        tok_sec = self._fresh_tok_sec()
                else:
                    self._note_tok_sec(tok_sec)

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
            # `models` is not necessarily a list of dicts; anything else used
            # to reach models_running[0].get(...) and raise.
            models_running = _dicts(ps_data.get("models"))

        if models_running:
            metrics[self._key("status")] = MetricValue(value="Running")
            metrics[self._key("health")] = MetricValue(value="ok")

            model_info = models_running[0]
            model_name = _text(model_info.get("model"))
            metrics[self._key("model")] = MetricValue(value=model_name)

            # Extract quant from model details if available
            details = model_info.get("details")
            details_map = details if isinstance(details, dict) else {}
            quant = _text(details_map.get("quantization_level"))
            if quant:
                metrics[self._key("quant")] = MetricValue(value=quant)

            # size_vram is resident VRAM, not a token count. It used to be
            # written to llama.context, which every other backend fills with
            # a context length -- a straight mislabel. Give it its own key.
            size_vram = _num(model_info.get("size_vram"))
            if size_vram:
                metrics[self._key("vram")] = MetricValue(
                    value=round(size_vram / (1024 * 1024)), unit="MiB"
                )
            ctx = _int(model_info.get("context_length"))
            if ctx is None:
                ctx = _int(details_map.get("context_length"))
            if ctx:
                metrics[self._key("context")] = MetricValue(value=ctx)
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
            # Same shape guard as Ollama: `data` is only usable when it is a
            # list of dicts.
            model_list = _dicts(models_data.get("data"))
            if model_list:
                metrics[self._key("status")] = MetricValue(value="Running")
                metrics[self._key("health")] = MetricValue(value="ok")
                model_id = _text(model_list[0].get("id"))
                metrics[self._key("model")] = MetricValue(value=model_id)
            else:
                metrics[self._key("status")] = MetricValue(value="Idle")
                metrics[self._key("health")] = MetricValue(value="ok")
        else:
            metrics[self._key("status")] = MetricValue(value="Stopped")
            metrics[self._key("health")] = MetricValue(value="no response")

        return metrics
