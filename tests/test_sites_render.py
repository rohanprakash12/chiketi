"""Rendering the files chiketi installs from a site."""
from __future__ import annotations

import pytest

from chiketi.sites.model import load_site
from chiketi.sites.render import PARTS, files_for, render_part
from tests.test_sites_model import make


@pytest.fixture
def site(tmp_path):
    return load_site(make(tmp_path))


def test_every_part_renders(site):
    for part in PARTS:
        did = "kiosk-1" if part.startswith("kiosk") else "wide-1" if part.startswith(("picture", "pusher")) else None
        out = render_part(site, part, did)
        assert out.content and "${" not in out.content and "$" not in out.content.replace("$HOME", "")


def test_kiosk_page_points_at_server_and_device(site):
    page = render_part(site, "kiosk-page", "kiosk-1")
    assert 'src="http://192.0.2.10:7777/display?device=kiosk-1"' in page.content
    assert page.host == "admin@192.0.2.20" and page.path == "/home/admin/kiosk/shell.html"
    assert page.sudo is False


def test_kiosk_page_escapes_values(site):
    from dataclasses import replace
    bad = replace(site, server=replace(site.server, address='x"></iframe><script>'))
    page = render_part(bad, "kiosk-page", "kiosk-1").content
    assert page.count("<script>") == 1 and page.count("</iframe>") == 1   # only the template's own tags
    assert 'src="http://x&quot;&gt;&lt;/iframe&gt;&lt;script&gt;:7777' in page
    assert "\\u003c/iframe\\u003e" in page                           # JS copies cannot close the script


def test_picture_unit_and_pusher(site):
    unit = render_part(site, "picture-unit", "wide-1")
    assert "LCD_URL=http://192.0.2.10:7777/display?device=wide-1&feed=picture" in unit.content
    assert "LCD_ALLOW=127.0.0.1,192.0.2.30" in unit.content and "LCD_W=1920" in unit.content
    assert unit.host == "admin@192.0.2.10"
    pusher = render_part(site, "pusher-config", "wide-1")
    assert 'url = "http://192.0.2.10:7778/lcd.png"' in pusher.content
    assert pusher.host == "admin@192.0.2.30" and pusher.path == "~/.config/chiketi-pusher/config.toml"


def test_feed_env_resolves_server(site):
    env = render_part(site, "feed-env", None)
    assert "FEED_ALLOW=127.0.0.1,192.0.2.10" in env.content and "FEED_PORT=8766" in env.content
    unit = render_part(site, "feed-unit", None)
    assert "ExecStart=/usr/bin/python3 /home/admin/src/chiketi/companions/session-feed/feed.py" in unit.content
    assert "EnvironmentFile=/etc/chiketi/session-feed.env" in unit.content


def test_server_files(site):
    files = files_for(site, "server")
    paths = {f.path for f in files}
    assert "/etc/systemd/system/chiketi.service" in paths
    assert "~/.config/chiketi/sessions.toml" in paths and "~/.config/chiketi/homelab.toml" in paths
    unit = next(f for f in files if f.path.endswith("chiketi.service"))
    assert "User=admin" in unit.content and "ExecStart=/opt/chiketi/venv/bin/chiketi --no-kiosk" in unit.content


def test_browser_display_files(site):
    files = files_for(site, "display", "kiosk-1")
    assert [f.path for f in files] == [
        "/home/admin/kiosk/shell.html", "/home/admin/kiosk/chromium-kiosk.sh",
        "/etc/systemd/system/kiosk.service", "/etc/systemd/logind.conf.d/90-kiosk.conf"]
    assert files[1].mode == "755"


def test_newline_values_refused(site):
    from dataclasses import replace
    bad = replace(site, server=replace(site.server, user="a\nb"))
    with pytest.raises(ValueError):
        render_part(bad, "server-unit")


def test_kiosk_page_health_check_works_from_file_url(site):
    # Opened from file://, a cross-origin XHR fails CORS even when the server answers;
    # an opaque no-cors fetch resolves on any answer.
    page = render_part(site, "kiosk-page", "kiosk-1").content
    assert "mode: 'no-cors'" in page and "XMLHttpRequest" not in page


def test_kiosk_page_hostile_display_id_escaped(site):
    from dataclasses import replace
    bad = replace(site, displays=(replace(site.displays[0], id="</script><script>alert(1)</script>"),)
                  + site.displays[1:])
    page = render_part(bad, "kiosk-page", "</script><script>alert(1)</script>").content
    assert page.count("<script>") == 1 and page.count("</script>") == 1
