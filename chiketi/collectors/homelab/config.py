"""homelab.toml: which hosts the Home Lab screen watches, and its thresholds."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field

KINDS = ("linux", "unraid", "gateway", "http")

DEFAULT_THRESHOLDS: dict[str, float] = {
    "fs_warn_pct": 85.0, "fs_crit_pct": 95.0,
    "mem_warn_pct": 10.0, "mem_crit_pct": 5.0,      # memory AVAILABLE below this
    "cpu_warn_c": 85.0, "cpu_crit_c": 95.0,
    "disk_warn_c": 50.0, "disk_crit_c": 60.0,
    "gpu_warn_c": 85.0, "gpu_crit_c": 92.0,
    "sec_updates_days": 14.0,
    "backup_max_age_h": 0.0,                        # 0 = backup age not checked
}


class ConfigError(ValueError):
    """homelab.toml exists but is not usable."""


@dataclass(frozen=True)
class Host:
    name: str
    kind: str
    address: str = ""
    user: str = ""
    port: int = 22
    url: str = ""
    token_file: str = ""
    backup_api: str = ""
    dns_name: str = "one.one.one.one"
    outside_ip: str = "1.1.1.1"


@dataclass(frozen=True)
class HomelabConfig:
    hosts: tuple[Host, ...]
    poll_seconds: float = 30.0
    ssh_key: str = ""
    known_hosts: str = ""
    thresholds: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_THRESHOLDS))


def _config_dir() -> str:
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "chiketi")


def default_path() -> str:
    return os.path.join(_config_dir(), "homelab.toml")


def _str(d: dict, key: str, where: str, default: str = "") -> str:
    v = d.get(key, default)
    if not isinstance(v, str):
        raise ConfigError(f"{where}: {key} must be a string")
    return v


def load_config(path: str) -> HomelabConfig:
    try:
        with open(path, "rb") as f:
            raw = tomllib.load(f)
    except FileNotFoundError:
        raise
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ConfigError(f"{path}: {exc}") from exc

    poll = raw.get("poll_seconds", 30)
    if not isinstance(poll, (int, float)) or not 10 <= poll <= 600:
        raise ConfigError("poll_seconds must be a number from 10 to 600")

    thresholds = dict(DEFAULT_THRESHOLDS)
    for k, v in (raw.get("thresholds") or {}).items():
        if k not in DEFAULT_THRESHOLDS:
            raise ConfigError(f"unknown threshold {k!r}")
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise ConfigError(f"threshold {k} must be a number")
        thresholds[k] = float(v)

    rows = raw.get("host")
    if not isinstance(rows, list) or not rows or len(rows) > 32:
        raise ConfigError("need 1-32 [[host]] tables")
    hosts: list[Host] = []
    seen: set[str] = set()
    for i, row in enumerate(rows):
        where = f"host #{i + 1}"
        if not isinstance(row, dict):
            raise ConfigError(f"{where}: must be a table")
        name = _str(row, "name", where).strip()
        if not 1 <= len(name) <= 32 or name in seen:
            raise ConfigError(f"{where}: name must be 1-32 chars and unique")
        seen.add(name)
        kind = _str(row, "kind", where)
        if kind not in KINDS:
            raise ConfigError(f"{where}: kind must be one of {', '.join(KINDS)}")
        port = row.get("port", 22)
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise ConfigError(f"{where}: port must be 1-65535")
        h = Host(
            name=name, kind=kind, address=_str(row, "address", where),
            user=_str(row, "user", where), port=port, url=_str(row, "url", where),
            token_file=os.path.expanduser(_str(row, "token_file", where)),
            backup_api=_str(row, "backup_api", where),
            dns_name=_str(row, "dns_name", where, "one.one.one.one"),
            outside_ip=_str(row, "outside_ip", where, "1.1.1.1"),
        )
        if kind in ("linux", "unraid", "gateway") and not h.address:
            raise ConfigError(f"{where}: {kind} hosts need an address")
        if kind in ("linux", "unraid") and not h.user:
            raise ConfigError(f"{where}: {kind} hosts need a user")
        if kind == "http" and not h.url.startswith(("http://", "https://")):
            raise ConfigError(f"{where}: http hosts need an http(s) url")
        if h.backup_api and not h.backup_api.startswith(("http://", "https://")):
            raise ConfigError(f"{where}: backup_api must be an http(s) url")
        hosts.append(h)

    return HomelabConfig(
        hosts=tuple(hosts), poll_seconds=float(poll),
        ssh_key=os.path.expanduser(_str(raw, "ssh_key", "top level", "~/.ssh/chiketi_homelab")),
        known_hosts=os.path.join(_config_dir(), "homelab_known_hosts"),
        thresholds=thresholds,
    )
