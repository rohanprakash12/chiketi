"""The shipped example site is valid and renders every part."""
from pathlib import Path

from chiketi.sites.model import load_site
from chiketi.sites.render import PARTS, render_part

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "site"


def test_example_site_is_valid_and_renders():
    site = load_site(EXAMPLE)
    for part in PARTS:
        did = next((d.id for d in site.displays if (d.kind == "browser") == part.startswith("kiosk")), None)
        if part.startswith(("feed",)):
            did = None
        if part == "pusher-config" and not any(d.pusher_ssh for d in site.displays):
            continue
        assert render_part(site, part, did).content
