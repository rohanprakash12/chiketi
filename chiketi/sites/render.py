"""Fill chiketi's templates from a site. Templates are part of chiketi; values come from the site."""

from __future__ import annotations

import html
import json
from dataclasses import dataclass
from importlib import resources
from string import Template

from chiketi.sites.model import Site

CONTROL_PORT = 7777
PICTURE_PORT = 7778
PARTS = ("server-unit", "kiosk-page", "kiosk-launcher", "kiosk-unit", "kiosk-logind",
         "picture-unit", "pusher-config", "feed-unit", "feed-env")


@dataclass(frozen=True)
class FileOut:
    host: str
    path: str
    content: str
    mode: str = "644"
    sudo: bool = True


def _js(value: str) -> str:
    """A JS string literal that cannot end the surrounding <script> element."""
    return json.dumps(value).replace("<", "\\u003c").replace(">", "\\u003e")


def _fill(name: str, **values) -> str:
    for k, v in values.items():
        # *_line values are whole lines prepared here (they end in a newline); everything else is one line
        if not k.endswith("_line") and ("\n" in str(v) or "\r" in str(v)):
            raise ValueError(f"{k}: values must be one line")
    text = resources.files("chiketi.sites").joinpath("templates", f"{name}.tmpl").read_text(encoding="utf-8")
    return Template(text).substitute(**values)


def _display_url(site: Site, display_id: str, picture: bool = False) -> str:
    url = f"http://{site.server.address}:{CONTROL_PORT}/display?device={display_id}"
    return url + "&feed=picture" if picture else url


def render_part(site: Site, part: str, display_id: str | None = None) -> FileOut:
    srv = site.server
    for v in (srv.address, srv.user, srv.home, srv.install_dir):
        if "\n" in v:
            raise ValueError("site values must be one line")
    if part == "server-unit":
        return FileOut(srv.ssh, "/etc/systemd/system/chiketi.service",
                       _fill("chiketi.service", site=site.name, user=srv.user, home=srv.home,
                             install_dir=srv.install_dir))
    if part == "feed-unit" or part == "feed-env":
        f = site.feed
        if f is None:
            raise KeyError("this site has no [session_feed]")
        if part == "feed-env":
            allow = ",".join(("127.0.0.1",) + tuple(a for a in site.resolve(f.readers) if a != "127.0.0.1"))
            return FileOut(f.ssh, "/etc/chiketi/session-feed.env", _fill("session-feed.env", allow=allow, port=f.port))
        mount = f"RequiresMountsFor={f.requires_mount}\n" if f.requires_mount else ""
        return FileOut(f.ssh, "/etc/systemd/system/claude-session-feed.service",
                       _fill("session-feed.service", user=f.user, chiketi_path=f.chiketi_path,
                             requires_mount_line=mount))
    d = site.display(display_id)
    if part == "kiosk-page":
        url = _display_url(site, d.id)
        return FileOut(d.ssh, f"{d.home}/kiosk/shell.html",
                       _fill("kiosk-shell.html", display_url_attr=html.escape(url, quote=True),
                             base_js=_js(f"http://{srv.address}:{CONTROL_PORT}"),
                             display_url_js=_js(url)), sudo=False)
    if part == "kiosk-launcher":
        return FileOut(d.ssh, f"{d.home}/kiosk/chromium-kiosk.sh",
                       _fill("chromium-kiosk.sh", browser=d.browser, home=d.home), mode="755", sudo=False)
    if part == "kiosk-unit":
        return FileOut(d.ssh, "/etc/systemd/system/kiosk.service",
                       _fill("kiosk.service", display_id=d.id, user=d.user, home=d.home))
    if part == "kiosk-logind":
        return FileOut(d.ssh, "/etc/systemd/logind.conf.d/90-kiosk.conf", _fill("90-kiosk-logind.conf"))
    if part == "picture-unit":
        allow = ",".join(("127.0.0.1",) + site.resolve(d.readers))
        return FileOut(srv.ssh, "/etc/systemd/system/lcd-snap.service",
                       _fill("lcd-snap.service", display_id=d.id, width=d.width, height=d.height,
                             user=srv.user, home=srv.home, url=_display_url(site, d.id, picture=True),
                             allow=allow))
    if part == "pusher-config":
        if not d.pusher_ssh:
            raise KeyError(f"display {d.id} has no pusher")
        return FileOut(d.pusher_ssh, d.pusher_config,
                       _fill("pusher.toml", display_id=d.id, width=d.width, height=d.height,
                             url=f"http://{srv.address}:{PICTURE_PORT}/lcd.png"), sudo=False)
    raise KeyError(f"unknown part {part!r}; one of {', '.join(PARTS)}")


def files_for(site: Site, target: str, display_id: str | None = None) -> list[FileOut]:
    if target == "server":
        out = [render_part(site, "server-unit")]
        for name in ("sessions.toml", "homelab.toml"):
            p = site.root / "server" / name
            if p.is_file():
                out.append(FileOut(site.server.ssh, f"~/.config/chiketi/{name}", p.read_text(encoding="utf-8"),
                                   mode="600", sudo=False))
        return out
    if target == "feed":
        return [render_part(site, "feed-env"), render_part(site, "feed-unit")]
    if target == "display":
        d = site.display(display_id)
        if d.kind == "browser":
            return [render_part(site, p, d.id) for p in ("kiosk-page", "kiosk-launcher", "kiosk-unit", "kiosk-logind")]
        out = [render_part(site, "picture-unit", d.id)]
        if d.pusher_ssh:
            out.append(render_part(site, "pusher-config", d.id))
        return out
    raise KeyError(f"unknown target {target!r}")
