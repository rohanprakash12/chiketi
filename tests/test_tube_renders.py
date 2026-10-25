"""The Tubes parts: the layout, the rendered files and the generated renderer layout agree."""
import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools" / "tube-renders"
ASSETS = ROOT / "chiketi" / "assets" / "tubes"
LAYOUT_JS = ROOT / "chiketi" / "assets" / "ui" / "tubes_layout.js"


def _layout():
    spec = importlib.util.spec_from_file_location("tube_layout", TOOLS / "layout.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


layout = _layout()


def _manifest():
    return json.loads((ASSETS / "manifest.json").read_text())


def _js_const(name):
    m = re.search(r"const " + name + r" = (.*?);\n", LAYOUT_JS.read_text())
    assert m, name
    return json.loads(m.group(1))


def test_every_manifest_file_exists_with_its_size():
    files = _manifest()["files"]
    assert files
    for name, info in files.items():
        p = ASSETS / (name + ".webp")
        assert p.exists(), name
        assert p.stat().st_size == info["bytes"], name


def test_layout_hash_is_the_same_everywhere():
    h = layout.layout_hash()
    assert _manifest()["layout_hash"] == h
    assert _js_const("TUBES_LAYOUT_HASH") == h
    assert _js_const("TUBES_HASH") == _manifest()["hash"]


def test_every_variant_and_height_has_a_panel_and_a_layout():
    files, js = _manifest()["files"], _js_const("TUBES_LAYOUT")
    assert _js_const("TUBES_HEIGHTS") == layout.HEIGHTS
    for v in layout.VARIANTS:
        for h in layout.HEIGHTS:
            name = f"panel-{v}-{h}"
            assert name in files and files[name]["w"] == 2048 and files[name]["h"] == 2 * h, name
            assert js[v][str(h)]["slots"], (v, h)


def test_assets_stay_within_the_budget():
    assert sum(f["bytes"] for f in _manifest()["files"].values()) <= 4.5 * 1024 * 1024


def test_no_stray_files_in_the_assets_folder():
    names = set(_manifest()["files"])
    for p in ASSETS.iterdir():
        assert p.name == "manifest.json" or (p.suffix == ".webp" and p.stem in names), p.name


@pytest.mark.parametrize("variant", layout.VARIANTS)
def test_everything_sits_inside_the_frame_at_every_height(variant):
    for h in layout.HEIGHTS:
        s = layout.screen(variant, h)
        for box in s["plates"] + s["labels"]:
            assert box["x"] >= 0 and box["y"] >= 0, (variant, h, box)
            assert box["x"] + box["w"] <= 1024 and box["y"] + box["h"] <= h, (variant, h, box)
        for sl in s["slots"]:
            # Lamps and eyes are centred on (x, y) with their bezel (1.1 x d); the tab row
            # spans the header; the clock's tubes end 186 units right of its x.
            r = 0 if sl["kind"] == "tabrow" else sl.get("d", 0) * 0.55
            y, hh = sl.get("y", 0), sl.get("h", 92 if sl["kind"] == "tabrow" else 0)
            w = 186 if sl["kind"] == "clock" else sl.get("w", 0)
            assert 0 <= sl["x"] - r and sl["x"] + w + r <= 1024, (variant, h, sl)
            assert 0 <= y - r and y + hh + r <= h, (variant, h, sl)


def test_the_design_height_keeps_the_v4_positions():
    """At 600 the body slots are the agreed v4 ones (spot checks from the mockup's layout)."""
    lab = layout.screen("lab", 600)
    fl = [s for s in lab["slots"] if s["kind"] == "faultlist"][0]
    assert (fl["x"], fl["y"], fl["w"], fl["h"]) == (26, 352, 972, 232)
    ses = layout.screen("sessions", 600)
    win = [s for s in ses["slots"] if s["kind"] == "swin"]
    assert [(w["x"], w["y"], w["h"]) for w in win] == [(70, 109 + 94 * k, 66) for k in range(5)]
    # (The GPU modules make room for a footer line by design: not compared.)


def test_the_manifest_hash_covers_the_layout_and_every_file():
    import hashlib
    m = _manifest()
    d = hashlib.sha256(m["layout_hash"].encode())
    # pack.py hashes in its own order: panels by variant and height, then the parts.
    order = [f"panel-{v}-{h}" for v in layout.VARIANTS for h in layout.HEIGHTS]
    order += [n for n in _pack_parts()]
    assert sorted(order) == sorted(m["files"])
    for name in order:
        d.update(name.encode() + hashlib.sha256((ASSETS / (name + ".webp")).read_bytes()).digest())
    assert d.hexdigest()[:12] == m["hash"]


def _pack_parts():
    src = (TOOLS / "pack.py").read_text()
    ns = {}
    start = src.index("PARTS = ")
    exec(src[start:src.index("PANELS = ")], ns)
    return ns["PARTS"]


def test_the_tab_row_holds_every_kiosk_screen():
    spec = json.loads((ROOT / "chiketi" / "assets" / "ui" / "screens.json").read_text())
    row = [s for s in layout.screen("lab", 600)["slots"] if s["kind"] == "tabrow"][0]
    ids = spec["modes"]["kiosk"]["screens"]
    width = sum(row["built_w"] if spec["screens"][i].get("built") else row["planned_w"] for i in ids)
    assert width <= row["w"], (width, row["w"])
