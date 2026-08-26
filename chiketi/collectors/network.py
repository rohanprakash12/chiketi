"""Network throughput delta-based collector, plus IP/MAC/link speed."""

from __future__ import annotations

import socket
import time

import psutil

from chiketi.collectors.base import MetricCollector, MetricValue


def _format_rate(bytes_per_sec: float) -> tuple[str, str]:
    """Return (value_str, unit) for a byte rate."""
    if bytes_per_sec >= 1_000_000:
        return f"{bytes_per_sec / 1_000_000:.1f}", "MB/s"
    if bytes_per_sec >= 1_000:
        return f"{bytes_per_sec / 1_000:.1f}", "KB/s"
    return f"{bytes_per_sec:.0f}", "B/s"


def _get_primary_ip() -> str | None:
    """Get IP of the default outbound interface."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return None


def _get_iface_for_ip(ip: str, addrs: dict) -> str | None:
    """Find the interface name holding the given IP, given a pre-fetched map.

    ``addrs`` is the result of a single ``psutil.net_if_addrs()`` call. Taking
    it as a parameter lets the caller reuse one snapshot for the interface
    lookup, the MAC lookup, and anything else, instead of walking every
    interface twice per collect cycle.
    """
    for iface, addr_list in addrs.items():
        for addr in addr_list:
            if addr.family == socket.AF_INET and addr.address == ip:
                return iface
    return None


class NetworkCollector(MetricCollector):
    namespace = "net"

    def __init__(self) -> None:
        self._prev_bytes_sent: int | None = None
        self._prev_bytes_recv: int | None = None
        self._prev_time: float | None = None
        # The interface the previous sample came from. Rates are only valid
        # when consecutive samples describe the same counter source.
        self._prev_iface: str | None = None

    def collect(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}

        # IP, MAC, link speed. `iface` is resolved here and reused by the
        # throughput block below, so it is initialised outside the try.
        iface: str | None = None
        try:
            ip = _get_primary_ip()
            if ip:
                metrics[self._key("ip")] = MetricValue(value=ip)
                # One net_if_addrs() snapshot serves both the interface lookup
                # and the MAC lookup; it used to be walked twice.
                addrs = psutil.net_if_addrs()
                iface = _get_iface_for_ip(ip, addrs)
                if iface:
                    # MAC address
                    for addr in addrs.get(iface, []):
                        if addr.family == psutil.AF_LINK:
                            metrics[self._key("mac")] = MetricValue(value=addr.address.upper())
                            break
                    # Link speed
                    stats = psutil.net_if_stats().get(iface)
                    if stats and stats.speed > 0:
                        metrics[self._key("speed")] = MetricValue(value=stats.speed, unit="Mbps")
                    else:
                        metrics[self._key("speed")] = MetricValue(available=False, unit="Mbps")
                else:
                    metrics[self._key("mac")] = MetricValue(available=False)
                    metrics[self._key("speed")] = MetricValue(available=False, unit="Mbps")
            else:
                metrics[self._key("ip")] = MetricValue(available=False)
                metrics[self._key("mac")] = MetricValue(available=False)
                metrics[self._key("speed")] = MetricValue(available=False, unit="Mbps")
        # Broad: a collector must never raise (see MetricCollector.collect).
        # psutil can raise OSError, PermissionError, RuntimeError and its own
        # psutil.Error hierarchy here, and a narrow tuple would let anything
        # else escape and cost the caller every other metric in this cycle.
        except Exception:
            metrics[self._key("ip")] = MetricValue(available=False)
            metrics[self._key("mac")] = MetricValue(available=False)
            metrics[self._key("speed")] = MetricValue(available=False, unit="Mbps")

        # Throughput (delta-based, scoped to the primary interface)
        try:
            counters = None
            pernic = psutil.net_io_counters(pernic=True)
            if iface and pernic:
                counters = pernic.get(iface)
            if counters is None:
                # No primary interface identified (or it has no counters): fall
                # back to the system-wide aggregate so the panel still shows
                # something rather than going blank. Mark the sample source as
                # None so a later switch to a real interface resets the delta.
                iface = None
                counters = psutil.net_io_counters()
            if counters is None:
                raise OSError("no network counters available")
            now = time.monotonic()

            if self._prev_time is not None and iface == self._prev_iface:
                dt = now - self._prev_time
                if dt > 0:
                    # Clamp negatives: an interface restart resets its
                    # counters, which would otherwise show as a large
                    # negative rate.
                    dl_rate = max(0.0, (counters.bytes_recv - self._prev_bytes_recv) / dt)
                    ul_rate = max(0.0, (counters.bytes_sent - self._prev_bytes_sent) / dt)
                else:
                    dl_rate = ul_rate = 0.0

                dl_val, dl_unit = _format_rate(dl_rate)
                ul_val, ul_unit = _format_rate(ul_rate)

                metrics[self._key("dl")] = MetricValue(
                    value=float(dl_val), unit=dl_unit,
                    extra={"raw_bytes_per_sec": dl_rate},
                )
                metrics[self._key("ul")] = MetricValue(
                    value=float(ul_val), unit=ul_unit,
                    extra={"raw_bytes_per_sec": ul_rate},
                )
            else:
                # First sample, or the counter source changed. Emit zero with
                # the same `extra` shape so consumers never see a missing key.
                metrics[self._key("dl")] = MetricValue(
                    value=0.0, unit="B/s", extra={"raw_bytes_per_sec": 0.0},
                )
                metrics[self._key("ul")] = MetricValue(
                    value=0.0, unit="B/s", extra={"raw_bytes_per_sec": 0.0},
                )

            self._prev_bytes_sent = counters.bytes_sent
            self._prev_bytes_recv = counters.bytes_recv
            self._prev_time = now
            self._prev_iface = iface
        # Broad for the same reason as above: losing dl/ul is acceptable,
        # losing the whole cycle is not.
        except Exception:
            metrics[self._key("dl")] = MetricValue(available=False)
            metrics[self._key("ul")] = MetricValue(available=False)
        return metrics
