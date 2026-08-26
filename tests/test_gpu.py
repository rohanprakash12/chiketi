"""GPU collector tests.

Everything here builds a fake /sys/class/drm tree on disk. The alternative is
mocking every open(), which would test the mock rather than the parsing, and
this machine has no discrete GPU to read from anyway.
"""

from __future__ import annotations

import os

import pytest

from chiketi.collectors.gpu import GpuCollector, merge_cards
from chiketi.collectors.gpu_sysfs import (
    _load_pci_ids,
    _lookup_pci_name,
    _parse_dpm_clock,
    normalize_bus_id,
    read_sysfs_cards,
    short_name,
)


# ----------------------------------------------------------------------
# fake sysfs
# ----------------------------------------------------------------------

def _write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(content)


def make_card(root: str, n: int, *, vendor: str, attrs: dict | None = None,
              hwmon: dict | None = None, pci: str | None = None,
              driver: str | None = "amdgpu") -> str:
    """Build one cardN device directory. Returns the device path."""
    pci = pci or f"0000:0{n}:00.0"
    # The real tree has card0/device as a symlink to the PCI node; the code
    # resolves it to recover the address, so the fake must too.
    pci_dir = os.path.join(root, "_pci", pci)
    os.makedirs(pci_dir, exist_ok=True)
    _write(os.path.join(pci_dir, "vendor"), vendor + "\n")
    for k, v in (attrs or {}).items():
        _write(os.path.join(pci_dir, k), str(v) + "\n")
    if hwmon:
        for k, v in hwmon.items():
            _write(os.path.join(pci_dir, "hwmon", "hwmon3", k), str(v) + "\n")
    if driver:
        # The real tree links device/driver at /sys/bus/pci/drivers/<name>.
        drv_dir = os.path.join(root, "_drivers", driver)
        os.makedirs(drv_dir, exist_ok=True)
        os.symlink(drv_dir, os.path.join(pci_dir, "driver"))
    card_dir = os.path.join(root, f"card{n}")
    os.makedirs(card_dir, exist_ok=True)
    os.symlink(pci_dir, os.path.join(card_dir, "device"))
    return pci_dir


AMD_ATTRS = {
    "device": "0x744c",
    "gpu_busy_percent": "73",
    "mem_busy_percent": "41",
    "mem_info_vram_used": str(9_100 * 1024 ** 2),
    "mem_info_vram_total": str(24_560 * 1024 ** 2),
    "pp_dpm_sclk": "0: 500Mhz\n1: 1800Mhz *\n2: 2482Mhz\n",
    "pp_dpm_mclk": "0: 96Mhz\n1: 1249Mhz *\n",
}
AMD_HWMON = {
    "name": "amdgpu",
    "temp1_input": "61000",
    "power1_average": "211000000",
    "power1_cap": "355000000",
    "fan1_input": "1450",
    "pwm1": "128",
}
INTEL_ATTRS = {"device": "0x56a0", "gt_cur_freq_mhz": "1650", "gt_max_freq_mhz": "2400"}
INTEL_HWMON = {"name": "i915", "temp1_input": "48000"}


@pytest.fixture
def drm(tmp_path):
    root = str(tmp_path / "drm")
    os.makedirs(root, exist_ok=True)
    return root


# ----------------------------------------------------------------------


class TestSysfsSingleCard:
    def test_amd_card_full_read(self, drm):
        make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON)
        (card,) = read_sysfs_cards(drm)
        assert card["vendor"] == "AMD"
        assert card["util"] == 73
        assert card["mem_util"] == 41
        assert card["vram_used"] == 9_100
        assert card["vram_total"] == 24_560
        assert card["vram_percent"] == pytest.approx(37.0, abs=0.2)
        assert card["temp"] == 61
        assert card["power"] == 211
        assert card["power_limit"] == 355
        assert card["fan_rpm"] == 1450
        assert card["fan"] == 50          # pwm 128/255
        assert card["clock_gpu"] == 1800
        assert card["clock_gpu_max"] == 2482
        assert card["clock_mem"] == 1249
        assert card["source"] == "sysfs"

    def test_intel_card_reports_what_the_driver_exposes(self, drm):
        """i915/xe give clocks and temp; utilisation needs perf, not sysfs.
        The card must still be listed rather than dropped."""
        make_card(drm, 0, vendor="0x8086", attrs=INTEL_ATTRS, hwmon=INTEL_HWMON)
        (card,) = read_sysfs_cards(drm)
        assert card["vendor"] == "Intel"
        assert card["clock_gpu"] == 1650
        assert card["clock_gpu_max"] == 2400
        assert card["temp"] == 48
        assert card["util"] is None       # honestly absent, not faked as 0
        assert card["vram_total"] is None

    @pytest.mark.parametrize("vendor", ["0x1af4", "0x1b36", "0x15ad", "0x1234"])
    def test_paravirtual_adapters_skipped(self, drm, vendor):
        """A VM's display adapter enumerates as a DRM card but has no
        telemetry. Listing it would mean a permanently blank dashboard tile."""
        make_card(drm, 0, vendor=vendor, attrs={"device": "0x0100"})
        assert read_sysfs_cards(drm) == []

    def test_card_with_no_telemetry_skipped(self, drm):
        make_card(drm, 0, vendor="0x1002", attrs={"device": "0x1234"})
        assert read_sysfs_cards(drm) == []

    def test_connector_directories_ignored(self, drm):
        """card0-DP-1 is a connector, not a device."""
        make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON)
        os.makedirs(os.path.join(drm, "card0-DP-1"), exist_ok=True)
        os.makedirs(os.path.join(drm, "card0-HDMI-A-1"), exist_ok=True)
        os.makedirs(os.path.join(drm, "renderD128"), exist_ok=True)
        assert len(read_sysfs_cards(drm)) == 1


class TestSysfsMultiCard:
    def test_three_mixed_cards(self, drm):
        make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON)
        make_card(drm, 1, vendor="0x8086", attrs=INTEL_ATTRS, hwmon=INTEL_HWMON)
        make_card(drm, 2, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON)
        cards = read_sysfs_cards(drm)
        assert [c["vendor"] for c in cards] == ["AMD", "Intel", "AMD"]
        assert [c["index"] for c in cards] == [0, 1, 2]

    def test_ten_cards_all_enumerated(self, drm):
        """The bug this replaces: the collector read device 0 and stopped."""
        for i in range(10):
            make_card(drm, i, vendor="0x1002", attrs=AMD_ATTRS,
                      hwmon=AMD_HWMON, pci=f"0000:{i:02d}:00.0")
        assert len(read_sysfs_cards(drm)) == 10

    def test_one_broken_card_does_not_cost_the_others(self, drm):
        make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON)
        # card1's device symlink dangles, the way a hot-removed card looks.
        os.makedirs(os.path.join(drm, "card1"), exist_ok=True)
        os.symlink(os.path.join(drm, "_gone"), os.path.join(drm, "card1", "device"))
        make_card(drm, 2, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON)
        cards = read_sysfs_cards(drm)
        assert len(cards) == 2

    def test_missing_root_returns_empty(self):
        assert read_sysfs_cards("/nonexistent/drm/root") == []


class TestFieldGuards:
    """Every value crossing into the renderers is bounded. A driver in a bad
    state reports nonsense, and a renderer that trusts it prints nonsense."""

    @pytest.mark.parametrize("field,raw,expect_key,expect", [
        ("gpu_busy_percent", "255", "util", None),
        ("gpu_busy_percent", "-5", "util", None),
        ("gpu_busy_percent", "not-a-number", "util", None),
        ("mem_info_vram_total", "-1", "vram_total", None),
        ("mem_info_vram_total", str(9 * 1024 ** 5), "vram_total", None),
    ])
    def test_out_of_range_values_rejected(self, drm, field, raw, expect_key, expect):
        attrs = dict(AMD_ATTRS)
        attrs[field] = raw
        make_card(drm, 0, vendor="0x1002", attrs=attrs, hwmon=AMD_HWMON)
        (card,) = read_sysfs_cards(drm)
        assert card[expect_key] is expect

    @pytest.mark.parametrize("temp,expect", [
        ("61000", 61), ("-273000", None), ("900000", None), ("junk", None),
    ])
    def test_temperature_bounds(self, drm, temp, expect):
        make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS,
                  hwmon={**AMD_HWMON, "temp1_input": temp})
        (card,) = read_sysfs_cards(drm)
        assert card["temp"] == expect

    def test_unreadable_attribute_does_not_abort_the_card(self, drm):
        dev = make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON)
        os.chmod(os.path.join(dev, "gpu_busy_percent"), 0o000)
        try:
            (card,) = read_sysfs_cards(drm)
        finally:
            os.chmod(os.path.join(dev, "gpu_busy_percent"), 0o644)
        assert card["util"] is None       # the one unreadable field
        assert card["temp"] == 61         # everything else survives

    def test_multiline_attribute_is_bounded(self, drm):
        """A driver bug producing an unbounded node must not be read whole."""
        attrs = dict(AMD_ATTRS)
        attrs["pp_dpm_sclk"] = "\n".join(f"{i}: {i}Mhz" for i in range(100_000))
        make_card(drm, 0, vendor="0x1002", attrs=attrs, hwmon=AMD_HWMON)
        (card,) = read_sysfs_cards(drm)
        assert card is not None


class TestDpmClockParsing:
    def test_active_state_flagged_with_asterisk(self):
        assert _parse_dpm_clock("0: 500Mhz\n1: 1800Mhz *\n2: 2482Mhz") == (1800, 2482)

    def test_no_active_state(self):
        assert _parse_dpm_clock("0: 500Mhz\n1: 1800Mhz") == (None, 1800)

    @pytest.mark.parametrize("raw", ["", None, "garbage", "0: Mhz"])
    def test_unparsable(self, raw):
        assert _parse_dpm_clock(raw) == (None, None)

    def test_case_insensitive(self):
        assert _parse_dpm_clock("0: 2100MHz *") == (2100, 2100)


class TestBusIdNormalisation:
    def test_nvml_and_sysfs_forms_match(self):
        """NVML pads the domain to eight digits; sysfs does not. Comparing
        them raw lists the same physical card twice."""
        assert normalize_bus_id("00000000:03:00.0") == normalize_bus_id("0000:03:00.0")

    def test_case_insensitive(self):
        assert normalize_bus_id("0000:0A:00.0") == normalize_bus_id("0000:0a:00.0")

    @pytest.mark.parametrize("raw", [None, "", "garbage", 42])
    def test_unusable_input(self, raw):
        assert normalize_bus_id(raw) is None


class TestMerge:
    def test_nvidia_card_seen_by_both_sources_listed_once(self):
        """The proprietary driver exposes an almost-empty sysfs node, so
        without the dedupe the card appears twice: once full, once blank."""
        nvml = [{"bus_id": "00000000:03:00.0", "name": "RTX 4090", "source": "nvml"}]
        sysfs = [{"bus_id": "0000:03:00.0", "name": "NVIDIA 0x2684", "source": "sysfs"}]
        merged = merge_cards(nvml, sysfs)
        assert len(merged) == 1
        assert merged[0]["source"] == "nvml"      # the richer source wins

    def test_mixed_vendor_rig_keeps_both(self):
        nvml = [{"bus_id": "00000000:01:00.0", "name": "RTX 4090"}]
        sysfs = [{"bus_id": "0000:03:00.0", "name": "AMD 0x744c"}]
        merged = merge_cards(nvml, sysfs)
        assert len(merged) == 2

    def test_indices_renumbered(self):
        """Each source indexes from zero, so a merged list would otherwise
        carry two cards both claiming index 0."""
        nvml = [{"bus_id": "00000000:01:00.0", "index": 0}]
        sysfs = [{"bus_id": "0000:03:00.0", "index": 0},
                 {"bus_id": "0000:04:00.0", "index": 1}]
        assert [c["index"] for c in merge_cards(nvml, sysfs)] == [0, 1, 2]

    def test_cards_without_bus_ids_are_all_kept(self):
        merged = merge_cards([{"name": "a"}], [{"name": "b"}, {"name": "c"}])
        assert len(merged) == 3

    def test_empty_sources(self):
        assert merge_cards([], []) == []


class TestGpuCollector:
    def test_no_cards_reports_unavailable_not_missing(self):
        c = GpuCollector()
        c._scanned = True
        m = c.collect()
        c.stop()
        assert m["gpu.count"].value == 0
        assert m["gpu.cards"].value == []
        assert m["gpu.temp"].available is False

    def test_flat_keys_mirror_card_zero(self):
        """Every shipped renderer reads the flat gpu.* keys. They must keep
        working unchanged on a single-card box."""
        c = GpuCollector()
        c._cards = [{
            "index": 0, "name": "Radeon RX 7900 XTX", "temp": 61, "fan": 50,
            "power": 211, "power_limit": 355, "vram_used": 9100,
            "vram_total": 24560, "vram_percent": 37.0, "util": 73,
            "mem_util": 41, "clock_gpu": 1800, "clock_gpu_max": 2482,
            "clock_mem": 1249, "clock_mem_max": 1249, "processes": [],
        }]
        c._scanned = True
        m = c.collect()
        c.stop()
        assert m["gpu.name"].value == "Radeon RX 7900 XTX"
        assert m["gpu.temp"].value == 61 and m["gpu.temp"].unit == "°C"
        assert m["gpu.power"].extra["limit"] == 355
        assert m["gpu.vram_used"].extra["total"] == 24560
        assert m["gpu.clock_gpu"].extra["max"] == 2482
        assert m["gpu.count"].value == 1

    def test_null_field_marked_unavailable_not_zero(self):
        """An Intel card has no utilisation figure. Reporting 0% would be a
        lie the renderer cannot distinguish from a genuinely idle card."""
        c = GpuCollector()
        c._cards = [{"index": 0, "name": "Arc A770", "util": None, "temp": 48}]
        c._scanned = True
        m = c.collect()
        c.stop()
        assert m["gpu.util"].available is False
        assert m["gpu.temp"].value == 48

    def test_collect_returns_a_copy(self):
        """A renderer mutating what it got back must not corrupt the cache."""
        c = GpuCollector()
        c._cards = [{"index": 0, "name": "card", "temp": 50}]
        c._scanned = True
        m = c.collect()
        m["gpu.cards"].value[0]["temp"] = 999
        assert c._cards[0]["temp"] == 50
        c.stop()

    def test_collect_never_raises_on_a_broken_source(self, monkeypatch):
        c = GpuCollector()
        monkeypatch.setattr(c._nvidia, "read_cards",
                            lambda: (_ for _ in ()).throw(RuntimeError("nvml exploded")))
        assert c._scan_once() is not None
        c.stop()


class TestPciIdNaming:
    """sysfs exposes only numeric ids, so without this a dashboard tile reads
    "AMD 0x744c". pci.ids ships with hwdata on essentially every distro."""

    def test_database_loads(self):
        assert len(_load_pci_ids()) > 1000

    @pytest.mark.parametrize("vendor,device,expect", [
        ("0x1002", "0x744c", "Radeon RX 7900 XT"),
        ("0x8086", "0x56a0", "Arc A770"),
        ("0x10de", "0x2684", "GeForce RTX 4090"),
    ])
    def test_real_ids_resolve(self, vendor, device, expect):
        full = _lookup_pci_name(vendor, device)
        assert full is not None
        assert short_name(full) == expect

    @pytest.mark.parametrize("vendor,device", [
        ("0x1002", "0xffff"), (None, "0x744c"), ("0x1002", None), ("", ""),
    ])
    def test_unknown_ids_return_none(self, vendor, device):
        assert _lookup_pci_name(vendor, device) is None

    def test_card_uses_the_resolved_name(self, drm):
        make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON)
        (card,) = read_sysfs_cards(drm)
        assert "Radeon RX 7900" in card["name"]
        assert card["short_name"] == "Radeon RX 7900 XT"

    def test_falls_back_to_numeric_when_id_is_unknown(self, drm):
        attrs = {**AMD_ATTRS, "device": "0xffff"}
        make_card(drm, 0, vendor="0x1002", attrs=attrs, hwmon=AMD_HWMON)
        (card,) = read_sysfs_cards(drm)
        assert card["name"] == "AMD 0xffff"

    def test_missing_database_does_not_break_naming(self, drm, monkeypatch):
        import chiketi.collectors.gpu_sysfs as g
        monkeypatch.setattr(g, "_PCI_IDS_PATHS", ("/nonexistent/pci.ids",))
        monkeypatch.setattr(g, "_pci_ids_cache", None)
        make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON)
        (card,) = read_sysfs_cards(drm)
        assert card["name"] == "AMD 0x744c"

    @pytest.mark.parametrize("full,expect", [
        ("Navi 31 [Radeon RX 7900 XT/7900 XTX/7900M]", "Radeon RX 7900 XT"),
        ("DG2 [Arc A770]", "Arc A770"),
        ("no brackets here", "no brackets here"),
        ("[]", "[]"),
        ("", None),
        (None, None),
        (42, None),
    ])
    def test_short_name(self, full, expect):
        assert short_name(full) == expect


class TestSymlinkResolution:
    """os.path.realpath() on a MISSING link returns the path unchanged, so a
    bare basename() yields the node's own name. That produced driver="driver"
    and would have produced bus_id="device", silently breaking the NVML
    dedupe - a card listed twice, once full and once nearly blank."""

    def test_driver_name_resolved(self, drm):
        make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON,
                  driver="amdgpu")
        (card,) = read_sysfs_cards(drm)
        assert card["driver"] == "amdgpu"

    def test_intel_driver_name_resolved(self, drm):
        make_card(drm, 0, vendor="0x8086", attrs=INTEL_ATTRS,
                  hwmon=INTEL_HWMON, driver="i915")
        (card,) = read_sysfs_cards(drm)
        assert card["driver"] == "i915"

    def test_unbound_card_reports_no_driver_not_the_word_driver(self, drm):
        """A card claimed by vfio, or with no module loaded, has no link."""
        make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON,
                  driver=None)
        (card,) = read_sysfs_cards(drm)
        assert card["driver"] is None

    def test_bus_id_is_the_pci_address(self, drm):
        make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON,
                  pci="0000:0c:00.0")
        (card,) = read_sysfs_cards(drm)
        assert card["bus_id"] == "0000:0c:00.0"
        assert normalize_bus_id(card["bus_id"]) == "0c:00.0"

    def test_bus_id_never_reports_the_literal_node_name(self, drm, tmp_path):
        """If device/ were a real directory rather than a link, the old code
        returned "device" - which normalises to None and breaks the dedupe."""
        root = str(tmp_path / "drm2")
        dev = os.path.join(root, "card0", "device")
        _write(os.path.join(dev, "vendor"), "0x1002\n")
        _write(os.path.join(dev, "gpu_busy_percent"), "50\n")
        cards = read_sysfs_cards(root)
        assert all(c["bus_id"] != "device" for c in cards)


class TestShortNameVendorPrefix:
    """NVML returns "NVIDIA GeForce RTX 3090 Ti". The tile already carries a
    vendor badge, so the prefix is redundancy in a field that has ~26
    characters -- but stripping it must not strip away meaning."""

    @pytest.mark.parametrize("full,expect", [
        ("NVIDIA GeForce RTX 3090 Ti", "GeForce RTX 3090 Ti"),
        ("Intel Arc A770", "Arc A770"),
        ("AMD Radeon RX 7900 XT", "Radeon RX 7900 XT"),
        # The numeric fallback keeps its vendor: "0x744c" alone names nothing.
        ("AMD 0x744c", "AMD 0x744c"),
        ("Intel 0x56a0", "Intel 0x56a0"),
        # A bare vendor is all there is; do not strip to empty.
        ("NVIDIA", "NVIDIA"),
        # Bracketed names are unaffected by the prefix rule.
        ("Navi 31 [Radeon RX 7900 XT/7900 XTX]", "Radeon RX 7900 XT"),
    ])
    def test_prefix_stripped_only_when_meaning_survives(self, full, expect):
        assert short_name(full) == expect


class TestNvmlCardShape:
    """Fields the real RTX 3090 Ti came back missing: without them the screen
    header renders "-- | <bus id>"."""

    def test_nvml_cards_carry_driver_and_short_name(self, monkeypatch):
        from chiketi.collectors.gpu_nvidia import GpuNvidiaCollector
        col = GpuNvidiaCollector()
        monkeypatch.setattr("chiketi.collectors.gpu_nvidia._ensure_nvml", lambda: True)

        class FakeNvml:
            NVML_TEMPERATURE_GPU = 0
            NVML_CLOCK_GRAPHICS = 0
            NVML_CLOCK_MEM = 1
            @staticmethod
            def nvmlDeviceGetCount(): return 1
            @staticmethod
            def nvmlDeviceGetHandleByIndex(i): return object()
            @staticmethod
            def nvmlDeviceGetName(h): return "NVIDIA GeForce RTX 3090 Ti"
            def __getattr__(self, name):
                raise AttributeError(name)

        fake = FakeNvml()
        monkeypatch.setitem(__import__("sys").modules, "pynvml", fake)
        cards = col.read_cards()
        assert len(cards) == 1
        assert cards[0]["driver"] == "nvidia"
        assert cards[0]["short_name"] == "GeForce RTX 3090 Ti"
        assert cards[0]["vendor"] == "NVIDIA"
        assert cards[0]["source"] == "nvml"

    def test_both_sources_produce_the_same_card_shape(self, drm, monkeypatch):
        """gpu.cards is public API. A consumer indexing card["fan_rpm"] should
        not have to know which source found the card -- an early version
        omitted the key on NVML cards and KeyError'd a caller."""
        from chiketi.collectors.gpu_nvidia import GpuNvidiaCollector
        col = GpuNvidiaCollector()
        monkeypatch.setattr("chiketi.collectors.gpu_nvidia._ensure_nvml", lambda: True)

        class FakeNvml:
            NVML_TEMPERATURE_GPU = 0
            NVML_CLOCK_GRAPHICS = 0
            NVML_CLOCK_MEM = 1
            @staticmethod
            def nvmlDeviceGetCount(): return 1
            @staticmethod
            def nvmlDeviceGetHandleByIndex(i): return object()
            @staticmethod
            def nvmlDeviceGetName(h): return "NVIDIA GeForce RTX 3090 Ti"
            def __getattr__(self, name):
                raise AttributeError(name)

        monkeypatch.setitem(__import__("sys").modules, "pynvml", FakeNvml())
        nvml_card = col.read_cards()[0]

        make_card(drm, 0, vendor="0x1002", attrs=AMD_ATTRS, hwmon=AMD_HWMON)
        (sysfs_card,) = read_sysfs_cards(drm)

        missing = set(sysfs_card) - set(nvml_card)
        assert not missing, f"NVML cards lack keys the sysfs cards have: {sorted(missing)}"


class TestNvmlBusIdDomain:
    """NVML pads the PCI domain to eight digits where the kernel and lspci use
    four. Left alone it reaches the screen looking like a different addressing
    scheme from the sysfs cards beside it."""

    @pytest.mark.parametrize("raw,expect", [
        ("00000000:01:00.0", "0000:01:00.0"),
        ("0000:03:00.0", "0000:03:00.0"),
        # A real non-zero domain must survive intact.
        ("00010000:01:00.0", "00010000:01:00.0"),
        ("garbage", "garbage"),
        (None, None),
    ])
    def test_domain_trimmed_only_when_the_dropped_digits_are_zero(self, raw, expect):
        from chiketi.collectors.gpu_nvidia import _normalize_domain
        assert _normalize_domain(raw) == expect

    def test_dedupe_still_matches_after_normalisation(self):
        """The trim must not break the cross-source match it exists beside."""
        from chiketi.collectors.gpu_nvidia import _normalize_domain
        assert (normalize_bus_id(_normalize_domain("00000000:01:00.0"))
                == normalize_bus_id("0000:01:00.0"))
