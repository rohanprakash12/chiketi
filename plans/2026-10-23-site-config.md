# Sites: Deployment Config Separated From the Software — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployment ("site") is a folder of config files only; a new `chiketi-site` command
validates it, renders every file chiketi installs from templates, and deploys each part.

**Architecture:** A new package `chiketi/sites/` with four modules: `model.py` parses and
validates `site.toml` and `server/*.toml` into frozen dataclasses; `render.py` fills
`string.Template` files from `chiketi/sites/templates/` into `FileOut` records; `remote.py`
applies `FileOut`s to machines over `ssh` with backup, diff and dry-run; `deploy.py` and
`cli.py` compose them into `check`, `render` and `deploy` subcommands. An example site in
`examples/site/` documents the format and runs in CI.

**Tech Stack:** Python ≥ 3.11 stdlib only (`tomllib`, `string.Template`, `subprocess`,
`difflib`, `argparse`, `urllib`); system `ssh`/`scp`/`git`; pytest.

**Spec:** `specs/2026-10-23-site-config-design.md`. Read it first.

## Global Constraints

- This repository is public: every example uses documentation addresses (192.0.2.x,
  198.51.100.x, 203.0.113.x) and made-up names. `tests/test_no_private_data.py` must stay green.
- No new runtime dependency (psutil stays the only one).
- A site folder contains config only: `site.toml`, `server/sessions.toml`, `server/homelab.toml`, optional `NOTES.md`.
- Unknown keys in `site.toml` are an error; keys that look like secrets (`token`, `password`,
  `passwd`, `secret`, `api_key`, `private_key`) are an error naming where the secret belongs.
- Every `deploy` supports `--dry-run` (writes nothing, prints diffs) and backs up a replaced
  file as `<path>.bak-YYYYMMDD` (only once per day per file); nothing is ever deleted.
- Machines are reached only with the system `ssh`/`scp`.
- Display ids follow `chiketi.devices.valid_id` (`a-z 0-9 -`, 1–32).
- Rendering refuses any value containing a newline.
- chiketi's control port is fixed at 7777 (`chiketi.server.CONTROL_PORT`); lcd-snap serves on 7778.
- Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01FoFFf4K4CUrdH6HPDArPdC`.

## Review Focus

1. **A site whose `server/homelab.toml` is invalid** must fail `check` and `deploy server` before
   anything is copied — pinned by `test_invalid_homelab_config_fails_check` (Task 1).
2. **A deploy against a file that is identical on the machine** must not write, back up or
   restart because of it — pinned by `test_apply_skips_unchanged_file` (Task 3).
3. **`--dry-run` must never run a writing command** (no `install`, no `cp`, no `systemctl`) —
   pinned by `test_dry_run_runs_only_reads` (Task 3).
4. **A display id or reader containing HTML/quote characters** is rejected by the model, and
   if one ever reached rendering the kiosk page would still be escaped — pinned by
   `test_kiosk_page_escapes_values` (Task 2) and `test_bad_display_id_rejected` (Task 1).
5. **Two displays with the same id** are an error, not "last one wins" — pinned by
   `test_duplicate_display_ids_rejected` (Task 1).

---

## File structure

| Path | Responsibility |
|---|---|
| `chiketi/sites/__init__.py` | package marker |
| `chiketi/sites/model.py` | `load_site()`, dataclasses, validation (`SiteError`) |
| `chiketi/sites/render.py` | `FileOut`, `render_part()`, `files_for()` |
| `chiketi/sites/templates/*.tmpl` | the generic files chiketi installs |
| `chiketi/sites/remote.py` | `Runner`, `apply()` (read, diff, backup, write) |
| `chiketi/sites/deploy.py` | `deploy_server/display/feed/probe()` |
| `chiketi/sites/cli.py` | `chiketi-site` argument parsing |
| `examples/site/` | example site with made-up values |
| `tests/test_sites_*.py` | unit tests |
| `pyproject.toml` | console script, package data, ruff config |
| `README.md`, `CLAUDE.md`, `docs/` | docs and website |

---

### Task 1: CI green — pinned lint rules

**Files:** Modify `pyproject.toml`; fix the findings listed below.

- [ ] **Step 1: Pin the rules.** In `pyproject.toml`, above `[tool.ruff.lint.per-file-ignores]`, add:

```toml
[tool.ruff]
line-length = 120

[tool.ruff.lint]
select = ["E", "F", "W", "I", "UP", "B"]
```

- [ ] **Step 2: See them fail.** Run `.venv/bin/ruff check .` — Expected: 27 findings (13 I001 plus
  14 others: `chiketi/collectors/claude.py:66` UP017, `cpu.py:111` B007, `gpu_sysfs.py:74`
  UP015, `homelab/poller.py:91` B905, `server.py:57` E402, `themes.py:6` UP035,
  `scripts/gen_site_assets.py` 3×UP031 and 3×E501, `tests/test_app.py:237` B905,
  `tests/test_devices.py:125` E501).

- [ ] **Step 3: Fix.** `.venv/bin/ruff check . --fix` (fixes I001, UP017, UP015, UP035). Then by hand:
  - `chiketi/server.py`: move the `from chiketi.devices import DeviceRegistry, clean_caps, valid_id`
    line from line 57 up into the import block at the top of the file.
  - `chiketi/collectors/cpu.py:111`: rename the unused loop variable `label` to `_label`.
  - `chiketi/collectors/homelab/poller.py:91` and `tests/test_app.py:237`: add `strict=True` to `zip(...)`
    (both zip lists of equal length by construction; if a test then fails, use `strict=False`
    and say why in a comment).
  - `scripts/gen_site_assets.py`: rewrite the three `%` formats as f-strings; wrap the three
    long lines (83, 84, 86) under 120 characters.
  - `tests/test_devices.py:125`: wrap the long line.

- [ ] **Step 4: Verify.** `.venv/bin/ruff check . && .venv/bin/python -m pytest -q && node tests/js/render_harness.js`
  Expected: `All checks passed!`, all tests pass, `renderer harness OK`.

- [ ] **Step 5: Commit** `git commit -am "ci: pin ruff rules to the ones the code follows; fix the rest"`

---

### Task 2: Site model and validation

**Files:** Create `chiketi/sites/__init__.py` (empty), `chiketi/sites/model.py`, `tests/test_sites_model.py`.

**Interfaces — Produces:**
- `class SiteError(ValueError)` with `.problems: list[str]`
- `@dataclass(frozen=True) Server(address, ssh, user, home, install_dir)`
- `@dataclass(frozen=True) Display(id, kind, ssh, user, home, browser, width, height, readers, pusher_ssh, pusher_config)`
- `@dataclass(frozen=True) Feed(ssh, user, home, chiketi_path, port, readers, requires_mount)`
- `@dataclass(frozen=True) Site(root: Path, name, server, displays: tuple[Display, ...], feed: Feed | None, probe_hosts: tuple[str, ...])`
  with `Site.display(id) -> Display` (KeyError if unknown) and `Site.resolve(readers) -> tuple[str, ...]`
  (`"server"` → `server.address`, other values unchanged, order kept, duplicates dropped)
- `load_site(root: str | Path) -> Site` (raises `SiteError` with every problem found)

- [ ] **Step 1: Write the failing tests** (`tests/test_sites_model.py`)

```python
"""site.toml: parsing and validation."""
from __future__ import annotations

import textwrap

import pytest

from chiketi.sites.model import SiteError, load_site

SITE = """
[site]
name = "example"

[server]
address = "192.0.2.10"
ssh = "admin@192.0.2.10"
user = "admin"

[[display]]
id = "kiosk-1"
kind = "browser"
ssh = "admin@192.0.2.20"
user = "admin"

[[display]]
id = "wide-1"
kind = "picture"
width = 1920
height = 462
readers = ["192.0.2.30"]
pusher_ssh = "admin@192.0.2.30"
pusher_config = "~/.config/chiketi-pusher/config.toml"

[session_feed]
ssh = "admin@192.0.2.40"
user = "admin"
chiketi_path = "/home/admin/src/chiketi"
readers = ["server"]

[homelab]
probe_hosts = ["admin@192.0.2.21"]
"""

SESSIONS = 'url = "http://192.0.2.40:8766/api/sessions"\npoll_seconds = 2\n'
HOMELAB = textwrap.dedent('''
    poll_seconds = 30
    ssh_key = "~/.ssh/chiketi_homelab"
    [[host]]
    name = "nas"
    kind = "linux"
    address = "192.0.2.21"
    user = "admin"
''')


def make(tmp_path, site=SITE, sessions=SESSIONS, homelab=HOMELAB):
    (tmp_path / "site.toml").write_text(site)
    (tmp_path / "server").mkdir()
    if sessions is not None:
        (tmp_path / "server" / "sessions.toml").write_text(sessions)
    if homelab is not None:
        (tmp_path / "server" / "homelab.toml").write_text(homelab)
    return tmp_path


def problems(tmp_path, **kw):
    with pytest.raises(SiteError) as e:
        load_site(make(tmp_path, **kw))
    return "\n".join(e.value.problems)


def test_loads_the_example(tmp_path):
    s = load_site(make(tmp_path))
    assert s.name == "example" and s.server.address == "192.0.2.10"
    assert s.server.home == "/home/admin" and s.server.install_dir == "/opt/chiketi"
    assert [d.id for d in s.displays] == ["kiosk-1", "wide-1"]
    assert s.display("wide-1").readers == ("192.0.2.30",)
    assert s.display("kiosk-1").browser == "chromium"
    assert s.feed.port == 8766 and s.resolve(s.feed.readers) == ("192.0.2.10",)
    assert s.probe_hosts == ("admin@192.0.2.21",)


def test_unknown_keys_are_errors(tmp_path):
    p = problems(tmp_path, site=SITE.replace('user = "admin"\n\n[[display]]', 'user = "admin"\nprot = 1\n\n[[display]]', 1))
    assert "server.prot: unknown key" in p


def test_secret_looking_keys_are_errors(tmp_path):
    p = problems(tmp_path, site=SITE + '\n[extra]\nha_token = "abc"\n')
    assert "extra.ha_token" in p and "secret" in p and "ha_token" in p


def test_bad_display_id_rejected(tmp_path):
    p = problems(tmp_path, site=SITE.replace('id = "kiosk-1"', 'id = "Kiosk<1>"'))
    assert "display[0].id" in p


def test_duplicate_display_ids_rejected(tmp_path):
    p = problems(tmp_path, site=SITE.replace('id = "wide-1"', 'id = "kiosk-1"'))
    assert "duplicate display id kiosk-1" in p


def test_newlines_rejected(tmp_path):
    p = problems(tmp_path, site=SITE.replace('user = "admin"', 'user = "ad\\nmin"', 1))
    assert "server.user: must be one line" in p


def test_kind_requirements(tmp_path):
    p = problems(tmp_path, site=SITE.replace('width = 1920\n', ''))
    assert "display[1] (picture) needs width" in p
    p = problems(tmp_path, site=SITE.replace('ssh = "admin@192.0.2.20"\n', '', 1))
    assert "display[0] (browser) needs ssh" in p


def test_invalid_homelab_config_fails_check(tmp_path):
    p = problems(tmp_path, homelab="poll_seconds = 1\n")
    assert "server/homelab.toml" in p


def test_invalid_sessions_config_fails_check(tmp_path):
    p = problems(tmp_path, sessions='url = "ftp://x"\n')
    assert "server/sessions.toml" in p


def test_unknown_server_file_rejected(tmp_path):
    root = make(tmp_path)
    (root / "server" / "ha_token").write_text("x")
    with pytest.raises(SiteError) as e:
        load_site(root)
    assert "server/ha_token" in "\n".join(e.value.problems)


def test_missing_site_toml(tmp_path):
    with pytest.raises(SiteError) as e:
        load_site(tmp_path)
    assert "site.toml" in str(e.value)
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest -q tests/test_sites_model.py` — Expected: ERROR, `No module named 'chiketi.sites'`.

- [ ] **Step 3: Implement** `chiketi/sites/model.py`:

```python
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

SECRET_KEY = re.compile(r"(token|password|passwd|secret|api_?key|private_?key)$", re.I)
SECRET_HELP = ("secrets never go in a site; keep them only on the machine that uses them "
               "(e.g. a Home Assistant token in the server's ~/.config/chiketi/ha_token, mode 600)")
SERVER_FILES = {"sessions.toml", "homelab.toml"}
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


def _server_files(root: Path, problems: list[str]) -> None:
    sdir = root / "server"
    if not sdir.is_dir():
        problems.append("server/: missing (holds sessions.toml and/or homelab.toml)")
        return
    for f in sorted(sdir.iterdir()):
        if f.name not in SERVER_FILES:
            problems.append(f"server/{f.name}: not a chiketi config file "
                            f"(allowed: {', '.join(sorted(SERVER_FILES))}); {SECRET_HELP}")
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
```

- [ ] **Step 4: Run** the tests — Expected: all pass. If `test_unknown_keys_are_errors` fails because the
  replace hit the wrong spot, fix the test's replace so it adds `prot = 1` to `[server]`.
  Then `.venv/bin/ruff check chiketi/sites tests/test_sites_model.py`.

- [ ] **Step 5: Commit** `git add chiketi/sites tests/test_sites_model.py && git commit -m "feat(sites): site.toml model and validation"`

---

### Task 3: Templates and rendering

**Files:** Create `chiketi/sites/render.py`, `chiketi/sites/templates/{chiketi.service,kiosk-shell.html,chromium-kiosk.sh,kiosk.service,90-kiosk-logind.conf,lcd-snap.service,pusher.toml,session-feed.service,session-feed.env}.tmpl`,
`tests/test_sites_render.py`; modify `pyproject.toml` (package data).

**Interfaces — Consumes:** `Site`, `Display`, `load_site` (Task 2).
**Produces:**
- `@dataclass(frozen=True) FileOut(host: str, path: str, content: str, mode: str = "644", sudo: bool = True)` — `host` is an ssh target, `path` absolute or `~/…`
- `PARTS = ("server-unit", "kiosk-page", "kiosk-launcher", "kiosk-unit", "kiosk-logind", "picture-unit", "pusher-config", "feed-unit", "feed-env")`
- `render_part(site, part, display_id=None) -> FileOut`
- `files_for(site, target, display_id=None) -> list[FileOut]` with `target` in `"server" | "display" | "feed"`;
  `"server"` = server unit + each `server/*.toml` (to `~/.config/chiketi/`, `sudo=False`, mode 600)

- [ ] **Step 1: Write the failing tests** (`tests/test_sites_render.py`)

```python
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
```

- [ ] **Step 2: Run** — Expected: ERROR, `No module named 'chiketi.sites.render'`.

- [ ] **Step 3: Write the templates.** In `chiketi/sites/templates/` (`string.Template`: `${name}`; a literal `$` is `$$`):

`chiketi.service.tmpl`
```ini
[Unit]
Description=chiketi dashboard server (site ${site})
After=network-online.target
Wants=network-online.target

[Service]
User=${user}
EnvironmentFile=-/etc/chiketi/env
ExecStart=${install_dir}/venv/bin/chiketi --no-kiosk --bind 0.0.0.0
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${home}/.config/chiketi ${home}/.local/state/chiketi
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

`kiosk-shell.html.tmpl` (ES5; frames the display, says so when the server stops answering)
```html
<!doctype html>
<meta charset="utf-8">
<title>chiketi kiosk</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  iframe { position: fixed; top: 0; left: 0; width: 100%; height: 100%; border: 0; }
  #down { position: fixed; top: 0; left: 0; right: 0; bottom: 0; display: none; background: #000; color: #ffb000;
          font: 600 3.2vw/1.4 sans-serif; align-items: center; justify-content: center;
          flex-direction: column; text-align: center; }
  #clock { font-size: 14vw; color: #ccc; }
</style>
<iframe id="f" src="${display_url_attr}"></iframe>
<div id="down"><div id="clock"></div><div id="msg"></div></div>
<script>
/* Generated by chiketi-site for display ${display_id_comment}. Shows the dashboard,
   and says so if the chiketi server stops answering for 30 s. Recovers on its own. */
var BASE = ${base_js};
var DISPLAY = ${display_url_js};
var lastOk = Date.now(), downSince = null;
function hhmm(t) {
  var d = new Date(t);
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
function check() {
  var r = new XMLHttpRequest();
  r.open('GET', BASE + '/api/health');
  r.timeout = 5000;
  r.onload = function () {
    if (downSince !== null) {
      downSince = null;
      document.getElementById('down').style.display = 'none';
      document.getElementById('f').src = DISPLAY;
    }
    lastOk = Date.now();
  };
  r.onerror = r.ontimeout = function () {
    if (downSince === null && Date.now() - lastOk > 30000) {
      downSince = lastOk;
      document.getElementById('msg').textContent =
        'Dashboard server unreachable since ' + hhmm(downSince) + '.';
      document.getElementById('down').style.display = 'flex';
    }
  };
  r.send();
}
setInterval(function () { document.getElementById('clock').textContent = hhmm(Date.now()); }, 1000);
setInterval(check, 10000);
check();
</script>
```
(The page is opened from `file://`, so this cross-origin request has no readable response; `onload`
fires on any answer, `onerror` on none — that is all the check needs.)

`chromium-kiosk.sh.tmpl`
```sh
#!/bin/sh
# Generated by chiketi-site. Launched by kiosk.service inside cage.
exec ${browser} \
  --kiosk "file://${home}/kiosk/shell.html" \
  --ozone-platform=wayland \
  --noerrdialogs --disable-infobars --no-first-run \
  --disable-session-crashed-bubble --hide-crash-restore-bubble \
  --disable-features=Translate,TranslateUI,MediaRouter \
  --check-for-update-interval=31536000 \
  --password-store=basic \
  --overscroll-history-navigation=0 --disable-pinch \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222
```

`kiosk.service.tmpl`
```ini
# Generated by chiketi-site: cage (single-app Wayland compositor) + browser kiosk on tty1.
[Unit]
Description=chiketi kiosk ${display_id} (cage + browser)
After=systemd-user-sessions.service network-online.target plymouth-quit-wait.service
Wants=network-online.target
Conflicts=getty@tty1.service
After=getty@tty1.service

[Service]
Type=simple
User=${user}
PAMName=login
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty-fail
UtmpIdentifier=tty1
UtmpMode=user
Environment=XDG_SESSION_TYPE=wayland
ExecStart=/usr/bin/cage -d -- ${home}/kiosk/chromium-kiosk.sh
Restart=always
RestartSec=5

[Install]
WantedBy=graphical.target
```

`90-kiosk-logind.conf.tmpl`
```ini
# Generated by chiketi-site: a kiosk never sleeps or powers off from lid or keys.
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
HandlePowerKey=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
IdleAction=ignore
```

`lcd-snap.service.tmpl`
```ini
[Unit]
Description=chiketi pictures for display ${display_id} (${width}x${height})
After=chiketi.service network-online.target
Wants=network-online.target

[Service]
User=${user}
Environment=HOME=${home}
Environment=LCD_URL=${url}
Environment=LCD_ALLOW=${allow}
Environment=LCD_W=${width}
Environment=LCD_H=${height}
ExecStart=/opt/lcd-snap/venv/bin/python /opt/lcd-snap/lcd_snap.py
Restart=always
RestartSec=5
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

`pusher.toml.tmpl`
```toml
# Generated by chiketi-site for display ${display_id}: where the pusher fetches its pictures.
url = "${url}"
width = ${width}
height = ${height}
stale_seconds = 15
```

`session-feed.service.tmpl`
```ini
[Unit]
Description=chiketi session feed (Claude Code / Codex sessions)
After=network-online.target local-fs.target
${requires_mount_line}Wants=network-online.target

[Service]
Type=simple
User=${user}
EnvironmentFile=/etc/chiketi/session-feed.env
ExecStart=/usr/bin/python3 ${chiketi_path}/companions/session-feed/feed.py
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`session-feed.env.tmpl`
```sh
# Generated by chiketi-site: who may read the session feed.
FEED_ALLOW=${allow}
FEED_PORT=${port}
```

- [ ] **Step 4: Implement** `chiketi/sites/render.py`:

```python
"""Fill chiketi's templates from a site. Templates are part of chiketi; values come from the site."""

from __future__ import annotations

import html
import json


def _js(value: str) -> str:
    """A JS string literal that cannot end the surrounding <script> element."""
    return json.dumps(value).replace("<", "\\u003c").replace(">", "\\u003e")
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
                             display_id_comment=d.id, base_js=_js(f"http://{srv.address}:{CONTROL_PORT}"),
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
```
(`_fill` refuses a newline in every value except `*_line` values, which `render.py` builds itself.)

In `pyproject.toml` `[tool.setuptools.package-data]` change `chiketi = ["assets/**/*"]` to
`chiketi = ["assets/**/*", "sites/templates/*.tmpl"]`, then `.venv/bin/pip install -q -e ".[dev]"`.

- [ ] **Step 5: Run** `.venv/bin/python -m pytest -q tests/test_sites_render.py tests/test_sites_model.py` — Expected: all pass.
  If `test_every_part_renders` trips on a `$` that belongs in the output, it is a template bug: escape it as `$$`.

- [ ] **Step 6: Commit** `git add chiketi/sites tests/test_sites_render.py pyproject.toml && git commit -m "feat(sites): templates and rendering for every installed file"`

---

### Task 4: Applying files to machines (`remote.py`)

**Files:** Create `chiketi/sites/remote.py`, `tests/test_sites_remote.py`.

**Interfaces — Consumes:** `FileOut` (Task 3). **Produces:**
- `class Runner` with `run(argv: list[str], input: str | None = None) -> subprocess.CompletedProcess` (default: real `subprocess.run`, text mode, no check)
- `remote_path(path: str) -> str` (shell-quoted; `~/x` → `"$HOME"/x`)
- `apply(files: list[FileOut], runner, dry_run: bool, today: str) -> list[tuple[FileOut, str]]`, status per file one of
  `"unchanged" | "would create" | "would change" | "created" | "changed"`; prints a unified diff for changes in dry-run

- [ ] **Step 1: Write the failing tests** (`tests/test_sites_remote.py`)

```python
"""Applying rendered files over ssh: read, compare, back up, write."""
from __future__ import annotations

import subprocess

from chiketi.sites.remote import apply, remote_path
from chiketi.sites.render import FileOut


class FakeRunner:
    def __init__(self, files=None):
        self.files = dict(files or {})       # (host, path) -> content
        self.calls = []

    def run(self, argv, input=None):
        self.calls.append((argv, input))
        host, cmd = argv[-2], argv[-1]
        if "cat " in cmd:
            path = cmd.split("cat ", 1)[1].strip().strip("'")
            key = (host, path.replace('"$HOME"/', "~/"))
            if key in self.files:
                return subprocess.CompletedProcess(argv, 0, self.files[key], "")
            return subprocess.CompletedProcess(argv, 1, "", "No such file")
        return subprocess.CompletedProcess(argv, 0, "", "")


F = FileOut("admin@192.0.2.20", "/etc/systemd/system/kiosk.service", "new\n")


def writes(r):
    return [a for a, _ in r.calls if any(w in a[-1] for w in ("install ", "cp -p", "systemctl"))]


def test_remote_path_quotes_and_expands_home():
    assert remote_path("~/.config/x y.toml") == '"$HOME"/' + "'.config/x y.toml'"
    assert remote_path("/etc/a b") == "'/etc/a b'"


def test_apply_skips_unchanged_file():
    r = FakeRunner({(F.host, F.path): "new\n"})
    assert apply([F], r, dry_run=False, today="20261023")[0][1] == "unchanged"
    assert writes(r) == []


def test_apply_backs_up_then_writes():
    r = FakeRunner({(F.host, F.path): "old\n"})
    assert apply([F], r, dry_run=False, today="20261023")[0][1] == "changed"
    cmds = [a[-1] for a, _ in r.calls]
    assert any("cp -p" in c and ".bak-20261023" in c for c in cmds)
    assert any("install -D -m 644 /dev/stdin" in c and c.startswith("sudo ") for c in cmds)
    assert any(i == "new\n" for _, i in r.calls)


def test_apply_creates_missing_without_backup():
    r = FakeRunner()
    assert apply([F], r, dry_run=False, today="20261023")[0][1] == "created"
    assert not any("cp -p" in a[-1] for a, _ in r.calls)


def test_dry_run_runs_only_reads(capsys):
    r = FakeRunner({(F.host, F.path): "old\n"})
    assert apply([F], r, dry_run=True, today="20261023")[0][1] == "would change"
    assert writes(r) == []
    out = capsys.readouterr().out
    assert "-old" in out and "+new" in out


def test_non_sudo_file_written_as_user():
    f = FileOut("admin@192.0.2.20", "~/kiosk/shell.html", "x", sudo=False)
    r = FakeRunner()
    apply([f], r, dry_run=False, today="20261023")
    w = [a[-1] for a, _ in r.calls if "install " in a[-1]][0]
    assert not w.startswith("sudo ") and '"$HOME"/' in w
```

- [ ] **Step 2: Run** — Expected: ERROR, `No module named 'chiketi.sites.remote'`.

- [ ] **Step 3: Implement** `chiketi/sites/remote.py`:

```python
"""Put rendered files on machines over ssh: read the current copy, compare, back up, write.
Never deletes anything. A dry run only reads."""

from __future__ import annotations

import difflib
import shlex
import subprocess

from chiketi.sites.render import FileOut

SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]


class Runner:
    def run(self, argv, input=None):
        return subprocess.run(argv, input=input, capture_output=True, text=True, check=False)


def remote_path(path: str) -> str:
    if path.startswith("~/"):
        return '"$HOME"/' + shlex.quote(path[2:])
    return shlex.quote(path)


def _ssh(runner, host: str, cmd: str, input=None):
    return runner.run(SSH + [host, cmd], input=input)


def apply(files: list[FileOut], runner, dry_run: bool, today: str) -> list[tuple[FileOut, str]]:
    results = []
    for f in files:
        rp = remote_path(f.path)
        sudo = "sudo " if f.sudo else ""
        cur = _ssh(runner, f.host, f"{sudo}cat {rp}")
        exists = cur.returncode == 0
        if exists and cur.stdout == f.content:
            results.append((f, "unchanged"))
            continue
        if dry_run:
            diff = difflib.unified_diff((cur.stdout if exists else "").splitlines(True), f.content.splitlines(True),
                                        f"{f.host}:{f.path} (now)", f"{f.host}:{f.path} (new)")
            print("".join(diff) or f"{f.host}:{f.path}: new file\n")
            results.append((f, "would change" if exists else "would create"))
            continue
        if exists:
            bak = remote_path(f"{f.path}.bak-{today}")
            r = _ssh(runner, f.host, f"[ -e {bak} ] || {sudo}cp -p {rp} {bak}")
            if r.returncode != 0:
                raise RuntimeError(f"{f.host}:{f.path}: backup failed: {r.stderr.strip()}")
        r = _ssh(runner, f.host, f"{sudo}install -D -m {f.mode} /dev/stdin {rp}", input=f.content)
        if r.returncode != 0:
            raise RuntimeError(f"{f.host}:{f.path}: write failed: {r.stderr.strip()}")
        results.append((f, "changed" if exists else "created"))
    return results
```

- [ ] **Step 4: Run** the tests — Expected: all pass. `ruff check chiketi/sites tests/test_sites_remote.py`.

- [ ] **Step 5: Commit** `git add chiketi/sites/remote.py tests/test_sites_remote.py && git commit -m "feat(sites): apply files over ssh with diff, backup and dry run"`

---

### Task 5: Deploy actions and the `chiketi-site` command

**Files:** Create `chiketi/sites/deploy.py`, `chiketi/sites/cli.py`, `tests/test_sites_cli.py`; modify `pyproject.toml` (`[project.scripts]`).

**Interfaces — Consumes:** `load_site`, `SiteError` (Task 2); `render_part`, `files_for`, `PARTS` (Task 3); `apply`, `Runner`, `SSH` (Task 4).
**Produces:** console script `chiketi-site = "chiketi.sites.cli:main"`; `main(argv=None, runner=None) -> int`.

Behaviour:
- `check`: print a summary (`site NAME: server ADDRESS; displays: ID (KIND), …; session feed on SSH; probe hosts: N`), exit 0; on `SiteError` print every problem, exit 2.
- `render PART [--display ID]`: print the file's content, exit 0.
- `deploy server [--ref REF] [--dry-run]`: in dry run, apply files only. Otherwise:
  `git -C <repo> archive --format=tar.gz -o <tmp> REF` (repo = `--repo` or the checkout containing
  this package), `scp` it to `SERVER:/tmp/chiketi.tgz`, run on the server
  `set -e; sudo rm -rf INSTALL/src.new && sudo mkdir -p INSTALL/src.new && sudo tar -xzf /tmp/chiketi.tgz -C INSTALL/src.new && { [ -x INSTALL/venv/bin/pip ] || sudo python3 -m venv INSTALL/venv; } && sudo INSTALL/venv/bin/pip install -q --upgrade INSTALL/src.new && sudo rm -rf INSTALL/src && sudo mv INSTALL/src.new INSTALL/src && echo SHA | sudo tee INSTALL/DEPLOYED >/dev/null && rm -f /tmp/chiketi.tgz`,
  then apply the server files, `sudo systemctl daemon-reload && sudo systemctl enable chiketi && sudo systemctl restart chiketi`,
  and poll `http://ADDRESS:7777/api/health` for up to 30 s (exit 1 if it never answers).
- `deploy display ID [--dry-run] [--restart-unit NAME]`: browser → apply files, then on the display
  `sudo systemctl daemon-reload && sudo systemctl enable kiosk && sudo systemctl restart kiosk`;
  picture → also copy `companions/lcd-snap/lcd_snap.py` (to `/opt/lcd-snap/lcd_snap.py`) and
  `apparmor-lcd-snap-chrome` (to `/etc/apparmor.d/lcd-snap-chrome`) as `FileOut`s on the server, then
  `sudo apparmor_parser -r /etc/apparmor.d/lcd-snap-chrome && sudo systemctl daemon-reload && sudo systemctl enable lcd-snap && sudo systemctl restart lcd-snap`;
  the pusher config is applied to `pusher_ssh`, and `--restart-unit NAME` restarts that unit there.
  Print once: "lcd-snap needs Chrome for Testing's headless shell in /opt/lcd-snap/ and a venv with websockets (see companions/lcd-snap/README.md)" when `/opt/lcd-snap/venv/bin/python` is missing on the server.
- `deploy feed [--dry-run]`: apply files, `sudo systemctl daemon-reload && sudo systemctl enable claude-session-feed && sudo systemctl restart claude-session-feed`.
- `deploy probe [HOST...]`: for each host (default `probe_hosts`) run `scripts/install-probe.sh HOST`
  from the repo with `HUB=<server.ssh>` in the environment; `--dry-run` prints the hosts only.
- Restarts are skipped when every file was `"unchanged"`. Print one line per file: `STATUS  HOST:PATH`.

- [ ] **Step 1: Write the failing tests** (`tests/test_sites_cli.py`)

```python
"""chiketi-site: check, render, deploy (with a fake ssh)."""
from __future__ import annotations

import subprocess

from chiketi.sites.cli import main
from tests.test_sites_model import make


class Recorder:
    def __init__(self, present=None):
        self.present = dict(present or {})
        self.calls = []

    def run(self, argv, input=None):
        self.calls.append(argv)
        cmd = argv[-1] if argv else ""
        if "cat " in cmd:
            return subprocess.CompletedProcess(argv, 1, "", "missing")
        if "test -x /opt/lcd-snap/venv/bin/python" in cmd:
            return subprocess.CompletedProcess(argv, 0, "", "")
        return subprocess.CompletedProcess(argv, 0, "", "")


def test_check_ok_and_errors(tmp_path, capsys):
    root = make(tmp_path)
    assert main(["check", "--site", str(root)]) == 0
    assert "kiosk-1 (browser)" in capsys.readouterr().out
    (root / "site.toml").write_text((root / "site.toml").read_text() + "\n[oops]\nx = 1\n")
    assert main(["check", "--site", str(root)]) == 2
    assert "oops: unknown section" in capsys.readouterr().out


def test_render_prints_file(tmp_path, capsys):
    root = make(tmp_path)
    assert main(["render", "kiosk-page", "--display", "kiosk-1", "--site", str(root)]) == 0
    assert "display?device=kiosk-1" in capsys.readouterr().out


def test_deploy_display_dry_run_writes_nothing(tmp_path):
    rec = Recorder()
    assert main(["deploy", "display", "kiosk-1", "--dry-run", "--site", str(make(tmp_path))], runner=rec) == 0
    assert not any("install " in a[-1] or "systemctl" in a[-1] for a in rec.calls)


def test_deploy_display_restarts_kiosk(tmp_path):
    rec = Recorder()
    assert main(["deploy", "display", "kiosk-1", "--site", str(make(tmp_path))], runner=rec) == 0
    assert any("systemctl restart kiosk" in a[-1] for a in rec.calls)


def test_deploy_feed(tmp_path):
    rec = Recorder()
    assert main(["deploy", "feed", "--site", str(make(tmp_path))], runner=rec) == 0
    assert any("systemctl restart claude-session-feed" in a[-1] for a in rec.calls)
```

- [ ] **Step 2: Run** — Expected: ERROR, `No module named 'chiketi.sites.cli'`.

- [ ] **Step 3: Implement** `chiketi/sites/deploy.py` and `chiketi/sites/cli.py`:

```python
# chiketi/sites/deploy.py
"""The deploy steps for each part of a site."""

from __future__ import annotations

import datetime
import os
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from chiketi.sites.remote import SSH, apply
from chiketi.sites.render import CONTROL_PORT, FileOut, files_for

REPO = Path(__file__).resolve().parents[2]


def _today() -> str:
    return datetime.date.today().strftime("%Y%m%d")


def _report(results) -> bool:
    for f, status in results:
        print(f"{status:13} {f.host}:{f.path}")
    return any(s in ("changed", "created") for _, s in results)


def _ssh(runner, host, cmd):
    r = runner.run(SSH + [host, cmd])
    if r.returncode != 0:
        raise RuntimeError(f"{host}: {cmd.split('&&')[0].strip()} failed: {r.stderr.strip()}")
    return r


def _restart(runner, host, unit):
    _ssh(runner, host, f"sudo systemctl daemon-reload && sudo systemctl enable {unit} && sudo systemctl restart {unit}")


def deploy_server(site, runner, dry_run, ref="HEAD", repo=REPO) -> int:
    files = files_for(site, "server")
    if dry_run:
        _report(apply(files, runner, True, _today()))
        return 0
    srv, inst = site.server, site.server.install_dir
    sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", ref], capture_output=True,
                         text=True, check=True).stdout.strip()
    with tempfile.TemporaryDirectory() as tmp:
        tgz = os.path.join(tmp, "chiketi.tgz")
        subprocess.run(["git", "-C", str(repo), "archive", "--format=tar.gz", "-o", tgz, ref], check=True)
        r = runner.run(["scp", "-q", tgz, f"{srv.ssh}:/tmp/chiketi.tgz"])
        if r.returncode != 0:
            raise RuntimeError(f"copy to {srv.ssh} failed: {r.stderr.strip()}")
    _ssh(runner, srv.ssh, (
        f"set -e; sudo rm -rf {inst}/src.new && sudo mkdir -p {inst}/src.new && "
        f"sudo tar -xzf /tmp/chiketi.tgz -C {inst}/src.new && "
        f"{{ [ -x {inst}/venv/bin/pip ] || sudo python3 -m venv {inst}/venv; }} && "
        f"sudo {inst}/venv/bin/pip install -q --upgrade {inst}/src.new && "
        f"sudo rm -rf {inst}/src && sudo mv {inst}/src.new {inst}/src && "
        f"echo {sha} | sudo tee {inst}/DEPLOYED >/dev/null && rm -f /tmp/chiketi.tgz"))
    _report(apply(files, runner, False, _today()))
    _restart(runner, srv.ssh, "chiketi")
    url = f"http://{srv.address}:{CONTROL_PORT}/api/health"
    for _ in range(30):
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                if resp.status == 200:
                    print(f"deployed {sha}; {url} answers")
                    return 0
        except OSError:
            time.sleep(1)
    print(f"deployed {sha}, but {url} does not answer")
    return 1


def deploy_display(site, runner, display_id, dry_run, restart_unit=None) -> int:
    d = site.display(display_id)
    files = files_for(site, "display", d.id)
    if d.kind == "picture":
        comp = REPO / "companions" / "lcd-snap"
        files[1:1] = [
            FileOut(site.server.ssh, "/opt/lcd-snap/lcd_snap.py", (comp / "lcd_snap.py").read_text()),
            FileOut(site.server.ssh, "/etc/apparmor.d/lcd-snap-chrome", (comp / "apparmor-lcd-snap-chrome").read_text()),
        ]
        probe = runner.run(SSH + [site.server.ssh, "test -x /opt/lcd-snap/venv/bin/python"])
        if probe.returncode != 0:
            print("lcd-snap needs Chrome for Testing's headless shell in /opt/lcd-snap/ and a venv with "
                  "websockets (see companions/lcd-snap/README.md)")
    results = apply(files, runner, dry_run, _today())
    changed = _report(results)
    if dry_run or not changed:
        return 0
    if d.kind == "browser":
        _restart(runner, d.ssh, "kiosk")
    else:
        server_changed = any(s in ("changed", "created") and f.host == site.server.ssh for f, s in results)
        if server_changed:
            _ssh(runner, site.server.ssh, "sudo apparmor_parser -r /etc/apparmor.d/lcd-snap-chrome")
            _restart(runner, site.server.ssh, "lcd-snap")
        if restart_unit and d.pusher_ssh:
            _ssh(runner, d.pusher_ssh, f"sudo systemctl restart {restart_unit}")
    return 0


def deploy_feed(site, runner, dry_run) -> int:
    results = apply(files_for(site, "feed"), runner, dry_run, _today())
    if _report(results) and not dry_run:
        _restart(runner, site.feed.ssh, "claude-session-feed")
    return 0


def deploy_probe(site, hosts, dry_run, repo=REPO) -> int:
    hosts = list(hosts) or list(site.probe_hosts)
    for h in hosts:
        print(f"probe: {h}")
        if not dry_run:
            subprocess.run([str(repo / "scripts" / "install-probe.sh"), h],
                           env={**os.environ, "HUB": site.server.ssh}, check=True)
    return 0
```

```python
# chiketi/sites/cli.py
"""chiketi-site: check, render and deploy a site (a folder of config files)."""

from __future__ import annotations

import argparse
import os
import sys

from chiketi.sites import deploy
from chiketi.sites.model import SiteError, load_site
from chiketi.sites.remote import Runner
from chiketi.sites.render import PARTS, render_part


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="chiketi-site", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("check", "render", "deploy"):
        s = sub.add_parser(name)
        s.add_argument("--site", default=os.environ.get("CHIKETI_SITE"), help="site folder (or CHIKETI_SITE)")
        if name == "render":
            s.add_argument("part", choices=PARTS)
            s.add_argument("--display")
        if name == "deploy":
            s.add_argument("what", choices=("server", "display", "feed", "probe"))
            s.add_argument("ids", nargs="*", help="display id, or probe hosts")
            s.add_argument("--dry-run", action="store_true")
            s.add_argument("--ref", default="HEAD")
            s.add_argument("--restart-unit")
    return p


def main(argv=None, runner=None) -> int:
    args = build_parser().parse_args(argv)
    if not args.site:
        print("chiketi-site: give --site DIR or set CHIKETI_SITE")
        return 2
    try:
        site = load_site(args.site)
    except SiteError as e:
        print(f"chiketi-site: {args.site} has problems:")
        for p in e.problems:
            print(f"  - {p}")
        return 2
    runner = runner or Runner()
    try:
        if args.cmd == "check":
            disp = ", ".join(f"{d.id} ({d.kind})" for d in site.displays) or "none"
            feed = site.feed.ssh if site.feed else "none"
            print(f"site {site.name}: server {site.server.address}; displays: {disp}; "
                  f"session feed on {feed}; probe hosts: {len(site.probe_hosts)}")
            return 0
        if args.cmd == "render":
            sys.stdout.write(render_part(site, args.part, args.display).content)
            return 0
        if args.what == "server":
            return deploy.deploy_server(site, runner, args.dry_run, args.ref)
        if args.what == "display":
            if len(args.ids) != 1:
                print("chiketi-site: deploy display needs one display id")
                return 2
            return deploy.deploy_display(site, runner, args.ids[0], args.dry_run, args.restart_unit)
        if args.what == "feed":
            return deploy.deploy_feed(site, runner, args.dry_run)
        return deploy.deploy_probe(site, args.ids, args.dry_run)
    except (KeyError, RuntimeError) as exc:
        print(f"chiketi-site: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
```

In `pyproject.toml` `[project.scripts]` add `chiketi-site = "chiketi.sites.cli:main"`; `.venv/bin/pip install -q -e ".[dev]"`.

- [ ] **Step 4: Run** `.venv/bin/python -m pytest -q tests/test_sites_*.py && .venv/bin/chiketi-site --help` — Expected: pass; help lists check/render/deploy.

- [ ] **Step 5: Commit** `git add chiketi/sites tests/test_sites_cli.py pyproject.toml && git commit -m "feat(sites): chiketi-site check, render and deploy"`

---

### Task 6: Example site and docs

**Files:** Create `examples/site/site.toml`, `examples/site/server/sessions.toml`, `examples/site/server/homelab.toml`,
`examples/site/README.md`, `tests/test_sites_example.py`; modify `README.md`, `CLAUDE.md`, `.github/workflows/ci.yml`.

- [ ] **Step 1: Failing test** (`tests/test_sites_example.py`)

```python
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
```

- [ ] **Step 2: Run** — Expected: FAIL (`site.toml: not found`).

- [ ] **Step 3: Write the example.** `examples/site/site.toml` = the `SITE` string from Task 2's tests,
  with a comment line above each key explaining it. `server/sessions.toml` = `SESSIONS` and
  `server/homelab.toml` = a commented version of `HOMELAB` with one host of each kind
  (`linux` 192.0.2.21, `unraid` 192.0.2.22, `gateway` 192.0.2.1, `http` `http://192.0.2.23:8123/api/`
  with `token_file = "~/.config/chiketi/ha_token"`). `examples/site/README.md`: copy this folder somewhere
  private, edit the addresses, run `chiketi-site check --site DIR`, then `deploy … --dry-run`, then `deploy`.
  Secrets: never here; list where each lives (HA token, probe SSH key, CHIKETI_TOKEN in `/etc/chiketi/env`).

- [ ] **Step 4: Docs.** README "Running as a hub for several displays": replace the per-component
  instructions with the site workflow (folder layout, the four deploy commands, dry run, what stays
  manual: OS/browser on a kiosk, the lcd-snap headless shell, approving displays in the panel, the
  pusher program for a USB screen). Add `chiketi-site` and `examples/` to Project layout and to
  `CLAUDE.md` ("Deploying" section: use `chiketi-site`; never hand-edit generated files on machines).
  In `.github/workflows/ci.yml` after the Test step add:
  ```yaml
      - name: Example site
        run: chiketi-site check --site examples/site
  ```

- [ ] **Step 5: Run** `.venv/bin/python -m pytest -q && .venv/bin/chiketi-site check --site examples/site && .venv/bin/ruff check .`
  Expected: all pass; the check prints the example summary.

- [ ] **Step 6: Commit** `git add examples tests/test_sites_example.py README.md CLAUDE.md .github/workflows/ci.yml && git commit -m "docs(sites): example site; README and CLAUDE.md use chiketi-site"`

---

### Task 7: Website in sync

**Files:** Modify `docs/index.html`; regenerate `docs/site/*`, `docs/assets/fonts/*`.

- [ ] **Step 1:** `.venv/bin/python scripts/gen_site_assets.py` (writes data.js with 17 themes, dashboard.js/css).
- [ ] **Step 2:** In `docs/index.html` replace "16 themes" with "17 themes" (three places: lines ~31, ~67, ~97) and
  "3 families" with "4 families"; anywhere the page lists the screens or says "five screens", add Home Lab and
  Claude Sessions (seven). Open it in a browser (or headless screenshot) and check the theme gallery shows Others/Claude.
- [ ] **Step 3:** Run the CI site check locally:
  `python scripts/gen_site_assets.py && git status --porcelain -- docs/` — Expected: no output after committing.
- [ ] **Step 4: Commit** `git add docs && git commit -m "site: regenerate for 17 themes and the new screens"`

---

### Task 8: Migrate the owner's site (private repository; nothing here is committed to chiketi)

Done in the owner's private companion repository. Values stay there.

- [ ] **Step 1:** Create the site folder there: `site.toml` with the real server, displays (one browser
  kiosk, one picture display with its pusher), session feed (with `requires_mount` if its checkout is on a
  network mount) and probe hosts; move the existing `sessions.toml`/`homelab.toml` into `server/`.
  `chiketi-site check --site <dir>` must pass.
- [ ] **Step 2: Equivalence check.** For each part run `chiketi-site deploy … --dry-run` and read every diff
  against the running files. Expected and acceptable differences: comments; the kiosk page's wording
  ("may be down" sentence); the session feed's environment file moving to `/etc/chiketi/session-feed.env`
  and its allowlist shrinking to localhost + server (the legacy kiosk page and the LCD's own sessions view
  no longer read it). Any other difference: fix the template or the site, re-run.
- [ ] **Step 3: Deploy** in this order, checking after each: `deploy server` (health answers, approved
  devices still listed at `/api/devices`), `deploy feed` (`/api/sessions` answers from the server),
  `deploy display <kiosk>` (kiosk reloads; still approved), `deploy display <picture>` (frames at
  `:7778/lcd.png`, reader still fetching).
- [ ] **Step 4: Pusher.** Cut the USB screen's existing driver down to: read `pusher.toml`
  (`url`, `width`, `height`, `stale_seconds`), fetch the picture every 2 s, push it to the screen, show a
  plain "no signal" frame after `stale_seconds` without a fresh picture. Remove its own session and
  backup views and their feeds. Keep its licence. Deploy it with a backup of the old program; verify the
  screen shows chiketi and that stopping lcd-snap gives "no signal" within ~15 s, then start lcd-snap again.
- [ ] **Step 5:** Reorganise the private repository: the site folder, notes and house-only tools; remove
  files now generated by chiketi-site (after the deploys above prove the generated ones run).
