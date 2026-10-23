"""A site: one deployment's configuration, kept outside the software.

site.toml says where everything runs; server/*.toml are copied as-is to the
server's ~/.config/chiketi/. A site holds config only -- no code, no secrets.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from chiketi.collectors import sessions as sessions_mod
from chiketi.collectors.homelab.config import ConfigError, load_config
from chiketi.devices import valid_id

SECRET_KEY = re.compile(r"(token|password|passwd|secret|key)$", re.I)
SECRET_HELP = ("secrets never go in a site; keep them only on the machine that uses them "
               "(e.g. a Home Assistant token in the server's ~/.config/chiketi/ha_token, mode 600)")
SERVER_FILES = {"sessions.toml", "homelab.toml"}
SECRET_PATH_KEYS = {"ssh_key", "token_file"}   # these name where a secret is, not the secret
TOP = {"site": "table", "server": "table", "display": "list", "session_feed": "table", "homelab": "table"}
SCHEMA = {
    "site": {"name": (str, True)},
    "server": {"address": (str, True), "ssh": (str, True), "user": (str, True),
               "home": (str, False), "install_dir": (str, False)},
    "display": {"id": (str, True), "kind": (str, True), "ssh": (str, False), "user": (str, False),
                "home": (str, False), "browser": (str, False), "width": (int, False),
                "height": (int, False), "readers": (list, False), "pusher_ssh": (str, False),
                "pusher_config": (str, False)},
    "session_feed": {"ssh": (str, True), "user": (str, True), "home": (str, False),
                     "chiketi_path": (str, True), "port": (int, False), "readers": (list, False),
                     "requires_mount": (str, False)},
    "homelab": {"probe_hosts": (list, False)},
}
SAFE = re.compile(r"^[A-Za-z0-9._~/@:+=-]*$")   # addresses, logins, paths, commands


class SiteError(ValueError):
    def __init__(self, problems: list[str]):
        self.problems = list(problems)
        super().__init__("\n".join(self.problems))


@dataclass(frozen=True)
class Server:
    address: str
    ssh: str
    user: str
    home: str
    install_dir: str


@dataclass(frozen=True)
class Display:
    id: str
    kind: str
    ssh: str | None
    user: str | None
    home: str | None
    browser: str
    width: int | None
    height: int | None
    readers: tuple[str, ...]
    pusher_ssh: str | None
    pusher_config: str | None


@dataclass(frozen=True)
class Feed:
    ssh: str
    user: str
    home: str
    chiketi_path: str
    port: int
    readers: tuple[str, ...]
    requires_mount: str | None


@dataclass(frozen=True)
class Site:
    root: Path
    name: str
    server: Server
    displays: tuple[Display, ...]
    feed: Feed | None
    probe_hosts: tuple[str, ...]

    def display(self, display_id: str) -> Display:
        for d in self.displays:
            if d.id == display_id:
                return d
        raise KeyError(display_id)

    def resolve(self, readers) -> tuple[str, ...]:
        out: list[str] = []
        for r in readers:
            v = self.server.address if r == "server" else r
            if v not in out:
                out.append(v)
        return tuple(out)


def _check_table(where: str, table: dict, schema: dict, problems: list[str]) -> dict:
    out = {}
    for key, value in table.items():
        if SECRET_KEY.search(key):
            problems.append(f"{where}.{key}: looks like a secret; {SECRET_HELP}")
            continue
        if key not in schema:
            problems.append(f"{where}.{key}: unknown key")
            continue
        typ, _ = schema[key]
        if typ is int and (isinstance(value, bool) or not isinstance(value, int)):
            problems.append(f"{where}.{key}: must be a whole number")
            continue
        if typ is str:
            if not isinstance(value, str):
                problems.append(f"{where}.{key}: must be text")
                continue
            if "\n" in value or "\r" in value:
                problems.append(f"{where}.{key}: must be one line")
                continue
            if not SAFE.match(value):
                problems.append(f"{where}.{key}: unexpected characters in {value!r}")
                continue
        if typ is list:
            if not isinstance(value, list) or not all(isinstance(v, str) and SAFE.match(v) and v for v in value):
                problems.append(f"{where}.{key}: must be a list of addresses or logins")
                continue
        out[key] = value
    for key, (_, required) in schema.items():
        if required and key not in table:
            problems.append(f"{where}.{key}: missing")
    return out


def _secret_keys(where: str, value, path: str, problems: list[str]) -> None:
    """Server files are copied as-is (and shown in dry-run diffs): no secrets in them either."""
    if isinstance(value, list):
        for i, v in enumerate(value):
            _secret_keys(where, v, f"{path}[{i}]", problems)
    elif isinstance(value, dict):
        for k, v in value.items():
            if SECRET_KEY.search(k) and k not in SECRET_PATH_KEYS:
                problems.append(f"{where}: {path}{'.' if path else ''}{k} looks like a secret; {SECRET_HELP}")
            _secret_keys(where, v, f"{path}{'.' if path else ''}{k}", problems)


def _same_login(where: str, t: dict, problems: list[str]) -> None:
    """Files for the account are written over this ssh login, so it must be that account."""
    ssh, user = t.get("ssh"), t.get("user")
    if ssh and user and "@" in ssh and ssh.split("@", 1)[0] != user:
        problems.append(f"{where}.ssh: must log in as {user} (the account that owns its files)")


def _server_files(root: Path, problems: list[str]) -> None:
    sdir = root / "server"
    if not sdir.is_dir():
        problems.append("server/: missing (holds sessions.toml and/or homelab.toml)")
        return
    for f in sorted(sdir.iterdir()):
        if f.name not in SERVER_FILES:
            problems.append(f"server/{f.name}: not a chiketi config file "
                            f"(allowed: {', '.join(sorted(SERVER_FILES))}); {SECRET_HELP}")
    for name in sorted(SERVER_FILES):
        f = sdir / name
        if f.is_file():
            try:
                _secret_keys(f"server/{name}", tomllib.loads(f.read_text(encoding="utf-8")), "", problems)
            except (OSError, tomllib.TOMLDecodeError):
                pass   # the loaders below report it
    sessions = sdir / "sessions.toml"
    if sessions.is_file() and sessions_mod._load(str(sessions)) is None:
        problems.append("server/sessions.toml: rejected by chiketi (see the message above)")
    homelab = sdir / "homelab.toml"
    if homelab.is_file():
        try:
            load_config(str(homelab))
        except (ConfigError, OSError) as exc:
            problems.append(f"server/homelab.toml: {exc}")


def load_site(root) -> Site:
    root = Path(root)
    problems: list[str] = []
    try:
        raw = tomllib.loads((root / "site.toml").read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SiteError([f"{root / 'site.toml'}: not found"]) from None
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise SiteError([f"site.toml: {exc}"]) from None

    for key in raw:
        if key not in TOP:
            if isinstance(raw[key], dict):
                for sub in raw[key]:
                    if SECRET_KEY.search(sub):
                        problems.append(f"{key}.{sub}: looks like a secret; {SECRET_HELP}")
            problems.append(f"{key}: unknown section")
    site_t = _check_table("site", raw.get("site", {}), SCHEMA["site"], problems)
    srv = _check_table("server", raw.get("server", {}), SCHEMA["server"], problems)
    displays, seen = [], set()
    for i, d in enumerate(raw.get("display", [])):
        where = f"display[{i}]"
        dt = _check_table(where, d if isinstance(d, dict) else {}, SCHEMA["display"], problems)
        did, kind = dt.get("id"), dt.get("kind")
        if did is not None and not valid_id(did):
            problems.append(f"{where}.id: {did!r} must be 1-32 of a-z 0-9 -")
        if did in seen:
            problems.append(f"duplicate display id {did}")
        seen.add(did)
        if kind == "browser":
            for need in ("ssh", "user"):
                if need not in dt:
                    problems.append(f"{where} (browser) needs {need}")
        elif kind == "picture":
            for need in ("width", "height"):
                if need not in dt:
                    problems.append(f"{where} (picture) needs {need}")
            if ("pusher_ssh" in dt) != ("pusher_config" in dt):
                problems.append(f"{where} (picture): pusher_ssh and pusher_config go together")
        elif kind is not None:
            problems.append(f"{where}.kind: {kind!r} must be browser or picture")
        user = dt.get("user")
        displays.append(Display(
            id=did or "", kind=kind or "", ssh=dt.get("ssh"), user=user,
            home=dt.get("home") or (f"/home/{user}" if user else None),
            browser=dt.get("browser", "chromium"), width=dt.get("width"), height=dt.get("height"),
            readers=tuple(dt.get("readers", [])), pusher_ssh=dt.get("pusher_ssh"),
            pusher_config=dt.get("pusher_config")))
    feed = None
    if "session_feed" in raw:
        ft = _check_table("session_feed", raw["session_feed"], SCHEMA["session_feed"], problems)
        port = ft.get("port", 8766)
        if not 1 <= port <= 65535:
            problems.append("session_feed.port: must be 1-65535")
        if {"ssh", "user", "chiketi_path"} <= ft.keys():
            feed = Feed(ssh=ft["ssh"], user=ft["user"], home=ft.get("home", f"/home/{ft['user']}"),
                        chiketi_path=ft["chiketi_path"], port=port,
                        readers=tuple(ft.get("readers", ["server"])),
                        requires_mount=ft.get("requires_mount"))
    inst = srv.get("install_dir", "/opt/chiketi")
    if not inst.startswith("/") or inst.rstrip("/") == "" or ".." in inst.split("/"):
        problems.append(f"server.install_dir: {inst!r} must be an absolute path below / (e.g. /opt/chiketi)")
    _same_login("server", srv, problems)
    for i, d in enumerate(displays):
        if d.kind == "browser":
            _same_login(f"display[{i}]", {"ssh": d.ssh, "user": d.user}, problems)
    if sum(d.kind == "picture" for d in displays) > 1:
        problems.append("only one picture display per site for now (lcd-snap is a single service on port 7778)")
    hl = _check_table("homelab", raw.get("homelab", {}), SCHEMA["homelab"], problems)
    _server_files(root, problems)
    if problems:
        raise SiteError(problems)
    return Site(
        root=root, name=site_t["name"],
        server=Server(address=srv["address"], ssh=srv["ssh"], user=srv["user"],
                      home=srv.get("home", f"/home/{srv['user']}"),
                      install_dir=srv.get("install_dir", "/opt/chiketi")),
        displays=tuple(displays), feed=feed, probe_hosts=tuple(hl.get("probe_hosts", [])))
