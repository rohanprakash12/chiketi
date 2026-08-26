"""Vendor-neutral GPU stats from the kernel's DRM sysfs tree.

Why sysfs rather than vendor CLIs: `rocm-smi` needs a full ROCm install and
`intel_gpu_top` usually needs root, so a collector built on them reports
nothing on a stock workstation. Everything here is exposed by the in-tree
amdgpu / i915 / xe drivers with no extra packages and no privileges.

What each driver actually gives:
  amdgpu   util, VRAM used/total, temp, power (+cap), fan, core/memory clocks
  i915/xe  core clock (current/max), temp; utilisation needs perf, not sysfs
  nvidia   almost nothing - the proprietary driver keeps its telemetry in
           NVML, which is why gpu_nvidia.py still owns NVIDIA cards.

Every read is guarded on its own. A driver can remove a node between the
listdir and the open, and a wedged card can make one attribute fail while its
neighbours still answer; losing one field must never cost the rest of a card,
and losing one card must never cost the others.
"""

from __future__ import annotations

import os
import re

_DRM_ROOT = "/sys/class/drm"

# A real card directory is "card0"; "card0-DP-1" is a connector, not a device.
_CARD_RE = re.compile(r"^card(\d+)$")

_VENDOR_NAMES = {
    "0x1002": "AMD",
    "0x1022": "AMD",
    "0x10de": "NVIDIA",
    "0x8086": "Intel",
}

# Paravirtual adapters. They enumerate as DRM cards but expose no telemetry,
# so listing them would put a permanently blank tile on the dashboard.
_VIRTUAL_VENDORS = {
    "0x1af4",   # virtio-gpu
    "0x1b36",   # Red Hat QXL
    "0x15ad",   # VMware SVGA
    "0x1414",   # Microsoft Hyper-V
    "0x1234",   # QEMU stdvga / bochs
}

_MAX_PLAUSIBLE_VRAM_MIB = 2 * 1024 * 1024   # 2 TiB, far above any real card

# The kernel exposes only numeric PCI ids, so sysfs alone can name a card no
# better than "AMD 0x744c". pci.ids ships with hwdata on essentially every
# Linux distribution and turns that into "Navi 31 [Radeon RX 7900 XTX]" with
# no subprocess and no network. Absent, the numeric name is the fallback.
_PCI_IDS_PATHS = (
    "/usr/share/hwdata/pci.ids",
    "/usr/share/misc/pci.ids",
    "/usr/share/pci.ids",
)

_pci_ids_cache: dict[tuple[str, str], str] | None = None


def _load_pci_ids() -> dict[tuple[str, str], str]:
    """Parse pci.ids into {(vendor, device): name}. Read once per process.

    The format is vendor lines at column 0 and device lines indented by one
    tab; deeper indents are subsystem entries, which we do not want.
    """
    global _pci_ids_cache
    if _pci_ids_cache is not None:
        return _pci_ids_cache
    table: dict[tuple[str, str], str] = {}
    for path in _PCI_IDS_PATHS:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                vendor = None
                for line in fh:
                    if not line or line.startswith("#"):
                        continue
                    stripped = line.rstrip("\n")
                    if not stripped.startswith("\t"):
                        # A vendor line, or the ill-formed class section at the
                        # end of the file; both end the previous vendor block.
                        parts = stripped.split(None, 1)
                        vendor = (parts[0].lower()
                                  if len(parts) == 2 and len(parts[0]) == 4 else None)
                    elif vendor and not stripped.startswith("\t\t"):
                        parts = stripped.strip().split(None, 1)
                        if len(parts) == 2 and len(parts[0]) == 4:
                            table[(vendor, parts[0].lower())] = parts[1].strip()
        except Exception:
            continue
        if table:
            break
    _pci_ids_cache = table
    return table


def _lookup_pci_name(vendor_id: str | None, device_id: str | None) -> str | None:
    """Marketing name for a PCI id pair, or None."""
    if not vendor_id or not device_id:
        return None
    try:
        v = vendor_id.lower().removeprefix("0x").zfill(4)
        d = device_id.lower().removeprefix("0x").zfill(4)
    except Exception:
        return None
    return _load_pci_ids().get((v, d))


def _read_text(path: str, limit: int = 4096) -> str | None:
    """Read a sysfs attribute, or None. Never raises.

    The cap matters: a few nodes (pp_dpm_sclk on a card with many states) are
    multi-line, and a driver bug could in principle produce an unbounded read.
    """
    try:
        with open(path, "rb") as fh:
            return fh.read(limit).decode("utf-8", "replace").strip()
    except Exception:
        return None


def _read_int(path: str) -> int | None:
    raw = _read_text(path, 64)
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _hwmon_dir(device_dir: str) -> str | None:
    """The card's hwmon instance, whose name is kernel-assigned and unstable."""
    base = os.path.join(device_dir, "hwmon")
    try:
        for entry in sorted(os.listdir(base)):
            if entry.startswith("hwmon"):
                return os.path.join(base, entry)
    except Exception:
        pass
    return None


def _parse_dpm_clock(raw: str | None) -> tuple[int | None, int | None]:
    """Current and maximum clock out of an amdgpu pp_dpm_* table.

    The format is one state per line, the active one flagged with a trailing
    asterisk:
        0: 500Mhz
        1: 1200Mhz *
        2: 2100Mhz
    """
    if not raw:
        return None, None
    current = None
    freqs: list[int] = []
    for line in raw.splitlines():
        m = re.search(r"(\d+)\s*mhz", line, re.IGNORECASE)
        if not m:
            continue
        try:
            mhz = int(m.group(1))
        except (TypeError, ValueError):
            continue
        freqs.append(mhz)
        if line.rstrip().endswith("*"):
            current = mhz
    return current, (max(freqs) if freqs else None)


def _pci_address(device_dir: str) -> str | None:
    """The card's PCI address, used to dedupe against NVML's busId."""
    try:
        return os.path.basename(os.path.realpath(device_dir)) or None
    except Exception:
        return None


def normalize_bus_id(bus_id: str | None) -> str | None:
    """Reduce a PCI address to bus:device.function for cross-source matching.

    NVML reports "00000000:03:00.0" (eight-digit domain) while sysfs reports
    "0000:03:00.0". Comparing them raw would list one card twice.
    """
    if not isinstance(bus_id, str) or not bus_id:
        return None
    parts = bus_id.strip().lower().split(":")
    if len(parts) < 2:
        return None
    return ":".join(parts[-2:])


def _driver_name(device_dir: str) -> str | None:
    try:
        return os.path.basename(os.path.realpath(os.path.join(device_dir, "driver"))) or None
    except Exception:
        return None


def _card_name(device_dir: str, vendor_id: str | None, driver: str | None) -> str:
    """Best available human name, without shelling out to lspci.

    Prefer the hwmon label the driver publishes, then vendor + PCI device id.
    """
    hw = _hwmon_dir(device_dir)
    if hw:
        label = _read_text(os.path.join(hw, "name"), 128)
        # "amdgpu"/"i915" as a hwmon name is the driver, not a product name.
        if label and label not in ("amdgpu", "i915", "xe"):
            return label
    device_id = _read_text(os.path.join(device_dir, "device"), 32)
    pretty = _lookup_pci_name(vendor_id, device_id)
    if pretty:
        return pretty
    vendor = _VENDOR_NAMES.get(vendor_id or "", None)
    if vendor and device_id:
        return f"{vendor} {device_id}"
    if vendor:
        return f"{vendor} GPU"
    return (driver or "GPU").upper()


def short_name(full: str | None) -> str | None:
    """A name that fits a dashboard tile.

    pci.ids names one silicon die per entry and lists every board built on it:
    "Navi 31 [Radeon RX 7900 XT/7900 XTX/7900M]". The bracketed part is the
    marketing name and the first variant is the representative one, so the
    tile shows "Radeon RX 7900 XT" instead of forty characters of die history.
    """
    if not isinstance(full, str) or not full.strip():
        return None
    text = full.strip()
    start, end = text.find("["), text.rfind("]")
    if 0 <= start < end:
        inner = text[start + 1:end].strip()
        if inner:
            text = inner
    # "RX 6700/6700 XT/6750 XT / 6800M" -> the first board on the list.
    text = text.split("/")[0].strip()
    return text or None


def _vram_mib(raw: int | None) -> int | None:
    """Bytes to MiB, rejecting values no real card could report."""
    if raw is None or raw < 0:
        return None
    mib = round(raw / (1024 ** 2))
    return mib if mib <= _MAX_PLAUSIBLE_VRAM_MIB else None


def read_card(device_dir: str, index: int) -> dict | None:
    """Read one card's device directory. None means "not a real GPU".

    Field-by-field guarding is deliberate: on a mixed rig one attribute can be
    unreadable (permissions, a driver that does not implement it, a card in a
    low-power state) while everything else answers normally.
    """
    vendor_id = _read_text(os.path.join(device_dir, "vendor"), 32)
    if vendor_id in _VIRTUAL_VENDORS:
        return None

    driver = _driver_name(device_dir)
    hw = _hwmon_dir(device_dir)
    card: dict = {
        "index": index,
        "source": "sysfs",
        "driver": driver,
        "vendor": _VENDOR_NAMES.get(vendor_id or "", None),
        "vendor_id": vendor_id,
        "bus_id": _pci_address(device_dir),
        "name": _card_name(device_dir, vendor_id, driver),
    }
    # The renderers have ~26 characters of tile; keep the full name for the
    # API and give them something that fits alongside it.
    card["short_name"] = short_name(card["name"]) or card["name"]

    # -- utilisation (amdgpu only; i915/xe expose this through perf, not sysfs)
    busy = _read_int(os.path.join(device_dir, "gpu_busy_percent"))
    card["util"] = busy if busy is not None and 0 <= busy <= 100 else None
    mem_busy = _read_int(os.path.join(device_dir, "mem_busy_percent"))
    card["mem_util"] = mem_busy if mem_busy is not None and 0 <= mem_busy <= 100 else None

    # -- VRAM
    used = _vram_mib(_read_int(os.path.join(device_dir, "mem_info_vram_used")))
    total = _vram_mib(_read_int(os.path.join(device_dir, "mem_info_vram_total")))
    card["vram_used"] = used
    card["vram_total"] = total
    if used is not None and total:
        card["vram_percent"] = round(used / total * 100, 1)
    else:
        card["vram_percent"] = None

    # -- temperature, power, fan (all under hwmon)
    card["temp"] = card["power"] = card["power_limit"] = None
    card["fan"] = card["fan_rpm"] = None
    if hw:
        milli_c = _read_int(os.path.join(hw, "temp1_input"))
        # Millidegrees. Anything outside this range is a misread, not a reading.
        if milli_c is not None and -50_000 < milli_c < 200_000:
            card["temp"] = round(milli_c / 1000)
        micro_w = _read_int(os.path.join(hw, "power1_average"))
        if micro_w is None:
            micro_w = _read_int(os.path.join(hw, "power1_input"))
        if micro_w is not None and 0 <= micro_w < 2_000_000_000:
            card["power"] = round(micro_w / 1_000_000)
        cap_uw = _read_int(os.path.join(hw, "power1_cap"))
        if cap_uw is not None and 0 < cap_uw < 2_000_000_000:
            card["power_limit"] = round(cap_uw / 1_000_000)
        rpm = _read_int(os.path.join(hw, "fan1_input"))
        if rpm is not None and 0 <= rpm < 100_000:
            card["fan_rpm"] = rpm
        # NVML reports fan as a percentage, so derive one from the PWM duty
        # cycle rather than leaving two different units under the same key.
        pwm = _read_int(os.path.join(hw, "pwm1"))
        if pwm is not None and 0 <= pwm <= 255:
            card["fan"] = round(pwm / 255 * 100)

    # -- clocks
    sclk, sclk_max = _parse_dpm_clock(_read_text(os.path.join(device_dir, "pp_dpm_sclk")))
    mclk, mclk_max = _parse_dpm_clock(_read_text(os.path.join(device_dir, "pp_dpm_mclk")))
    if sclk is None:
        # Intel i915/xe path, and amdgpu cards without the DPM tables.
        cur = _read_int(os.path.join(device_dir, "gt_cur_freq_mhz"))
        sclk = cur if cur is not None and 0 <= cur < 10_000 else None
    if sclk_max is None:
        mx = _read_int(os.path.join(device_dir, "gt_max_freq_mhz"))
        sclk_max = mx if mx is not None and 0 < mx < 10_000 else None
    card["clock_gpu"] = sclk
    card["clock_gpu_max"] = sclk_max
    card["clock_mem"] = mclk
    card["clock_mem_max"] = mclk_max

    card["processes"] = []

    # A card that answers nothing is a display adapter we cannot report on.
    # Listing it would mean a permanently empty tile on the dashboard.
    telemetry = ("util", "vram_total", "temp", "power", "clock_gpu", "fan_rpm")
    if all(card.get(k) is None for k in telemetry):
        return None
    return card


def read_sysfs_cards(root: str = _DRM_ROOT) -> list[dict]:
    """Every GPU the DRM tree exposes telemetry for, in card-number order."""
    try:
        entries = sorted(os.listdir(root))
    except Exception:
        return []

    cards: list[dict] = []
    for entry in entries:
        m = _CARD_RE.match(entry)
        if not m:
            # "card0-HDMI-A-1" is a connector; only bare cardN is a device.
            continue
        device_dir = os.path.join(root, entry, "device")
        try:
            card = read_card(device_dir, int(m.group(1)))
        # One unreadable card must not cost the others: a mixed rig with a
        # card in a bad state still reports the healthy ones.
        except Exception:
            continue
        if card is not None:
            cards.append(card)
    return cards
