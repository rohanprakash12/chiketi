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


def _get_iface_for_ip(ip: str) -> str | None:
    """Find the network interface name that has the given IP."""
    for iface, addrs in psutil.net_if_addrs().items():
        for addr in addrs:
            if addr.family == socket.AF_INET and addr.address == ip:
                return iface
    return None


class NetworkCollector(MetricCollector):
    namespace = "net"

    def __init__(self) -> None:
        self._prev_bytes_sent: int | None = None
        self._prev_bytes_recv: int | None = None
        self._prev_time: float | None = None

    def collect(self) -> dict[str, MetricValue]:
        metrics: dict[str, MetricValue] = {}

        # IP, MAC, link speed
        try:
            ip = _get_primary_ip()
            if ip:
                metrics[self._key("ip")] = MetricValue(value=ip)
                iface = _get_iface_for_ip(ip)
                if iface:
                    # MAC address
                    for addr in psutil.net_if_addrs().get(iface, []):
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
        except Exception:
            metrics[self._key("ip")] = MetricValue(available=False)
            metrics[self._key("mac")] = MetricValue(available=False)
            metrics[self._key("speed")] = MetricValue(available=False, unit="Mbps")

        # Throughput (delta-based)
        try:
            counters = psutil.net_io_counters()
            now = time.monotonic()

            if self._prev_time is not None:
                dt = now - self._prev_time
                if dt > 0:
                    dl_rate = (counters.bytes_recv - self._prev_bytes_recv) / dt
                    ul_rate = (counters.bytes_sent - self._prev_bytes_sent) / dt
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
                metrics[self._key("dl")] = MetricValue(value=0.0, unit="B/s")
                metrics[self._key("ul")] = MetricValue(value=0.0, unit="B/s")

            self._prev_bytes_sent = counters.bytes_sent
            self._prev_bytes_recv = counters.bytes_recv
            self._prev_time = now
        except Exception:
            metrics[self._key("dl")] = MetricValue(available=False)
            metrics[self._key("ul")] = MetricValue(available=False)
        return metrics
