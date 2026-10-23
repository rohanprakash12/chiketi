# tests/test_homelab_config.py
from __future__ import annotations

import pytest

from chiketi.collectors.homelab.config import (
    DEFAULT_THRESHOLDS,
    ConfigError,
    default_path,
    load_config,
)

GOOD = """
poll_seconds = 30
ssh_key = "~/.ssh/chiketi_homelab"

[thresholds]
fs_warn_pct = 80

[[host]]
name = "Atlas"
kind = "unraid"
address = "192.0.2.212"
user = "root"
backup_api = "http://192.0.2.212:8765/api/status"

[[host]]
name = "pfSense"
kind = "gateway"
address = "192.0.2.1"

[[host]]
name = "Home Assistant"
kind = "http"
url = "http://192.0.2.30:8123/api/"
token_file = "~/.config/chiketi/ha_token"
"""


def write(tmp_path, text):
    p = tmp_path / "homelab.toml"
    p.write_text(text)
    return str(p)


def test_good(tmp_path):
    cfg = load_config(write(tmp_path, GOOD))
    assert [h.name for h in cfg.hosts] == ["Atlas", "pfSense", "Home Assistant"]
    assert cfg.hosts[0].user == "root" and cfg.hosts[0].port == 22
    assert cfg.thresholds["fs_warn_pct"] == 80
    assert cfg.thresholds["fs_crit_pct"] == DEFAULT_THRESHOLDS["fs_crit_pct"]
    assert not cfg.ssh_key.startswith("~")
    assert cfg.known_hosts.endswith("homelab_known_hosts")


def test_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_config(str(tmp_path / "nope.toml"))


@pytest.mark.parametrize("bad", [
    "not toml [",
    "poll_seconds = 1\n[[host]]\nname='a'\nkind='gateway'\naddress='1.1.1.1'",
    "[[host]]\nname='a'\nkind='spaceship'\naddress='x'",
    "[[host]]\nname='a'\nkind='linux'",
    "[[host]]\nname='a'\nkind='http'\nurl='ftp://x'",
    "[[host]]\nname='a'\nkind='gateway'\naddress='x'\n[[host]]\nname='a'\nkind='gateway'\naddress='y'",
    "[thresholds]\nmystery = 3\n[[host]]\nname='a'\nkind='gateway'\naddress='x'",
    "[thresholds]\nfs_warn_pct = 'high'\n[[host]]\nname='a'\nkind='gateway'\naddress='x'",
    "hosts = []",
])
def test_invalid(tmp_path, bad):
    with pytest.raises(ConfigError):
        load_config(write(tmp_path, bad))


def test_default_path_uses_xdg(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    assert default_path() == str(tmp_path / "chiketi" / "homelab.toml")
