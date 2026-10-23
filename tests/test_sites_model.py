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
    (tmp_path / "server").mkdir(exist_ok=True)
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
    site = SITE.replace('user = "admin"\n\n[[display]]', 'user = "admin"\nprot = 1\n\n[[display]]', 1)
    p = problems(tmp_path, site=site)
    assert "server.prot: unknown key" in p


def test_secret_looking_keys_are_errors(tmp_path):
    p = problems(tmp_path, site=SITE + '\n[extra]\nha_token = "abc"\n')
    assert "extra.ha_token" in p and "secret" in p and "ha_token" in p


def test_any_key_named_key_is_a_secret(tmp_path):
    p = problems(tmp_path, site=SITE.replace('user = "admin"', 'user = "admin"\nha_key = "abc"', 1))
    assert "server.ha_key: looks like a secret" in p


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


def test_install_dir_must_be_absolute_and_not_root(tmp_path):
    for bad in ('""', '"opt/chiketi"', '"/"', '"/opt/../etc"', '"~/chiketi"'):
        site = SITE.replace('user = "admin"\n\n[[display]]', f'user = "admin"\ninstall_dir = {bad}\n\n[[display]]', 1)
        assert "server.install_dir" in problems(tmp_path, site=site), bad


def test_ssh_login_must_be_the_service_user(tmp_path):
    p = problems(tmp_path, site=SITE.replace('ssh = "admin@192.0.2.10"', 'ssh = "root@192.0.2.10"'))
    assert "server.ssh: must log in as admin" in p
    p = problems(tmp_path, site=SITE.replace('ssh = "admin@192.0.2.20"', 'ssh = "root@192.0.2.20"'))
    assert "display[0].ssh: must log in as admin" in p


def test_secret_keys_in_server_files_rejected(tmp_path):
    p = problems(tmp_path, sessions=SESSIONS + 'password = "EXAMPLE"\n')
    assert "server/sessions.toml: password looks like a secret" in p
    p = problems(tmp_path, homelab=HOMELAB + 'api_token = "EXAMPLE"\n')
    assert "server/homelab.toml: host[0].api_token looks like a secret" in p


def test_server_file_path_keys_allowed(tmp_path):
    hl = HOMELAB + '[[host]]\nname = "ha"\nkind = "http"\nurl = "http://192.0.2.23/"\ntoken_file = "~/t"\n'
    assert load_site(make(tmp_path, homelab=hl)).name == "example"


def test_only_one_picture_display(tmp_path):
    extra = '\n[[display]]\nid = "wide-2"\nkind = "picture"\nwidth = 800\nheight = 480\n'
    p = problems(tmp_path, site=SITE.replace("[session_feed]", extra + "\n[session_feed]"))
    assert "only one picture display" in p


def test_install_dir_that_normalises_to_root_rejected(tmp_path):
    for bad in ('"/./"', '"//"', '"/opt/.."'):
        site = SITE.replace('user = "admin"\n\n[[display]]', f'user = "admin"\ninstall_dir = {bad}\n\n[[display]]', 1)
        assert "server.install_dir" in problems(tmp_path, site=site), bad


def test_ssh_login_must_name_the_user(tmp_path):
    p = problems(tmp_path, site=SITE.replace('ssh = "admin@192.0.2.10"', 'ssh = "192.0.2.10"'))
    assert "server.ssh: must log in as admin" in p


def test_secret_path_exceptions_only_where_documented(tmp_path):
    p = problems(tmp_path, sessions=SESSIONS + 'ssh_key = "EXAMPLE"\n')
    assert "server/sessions.toml: ssh_key looks like a secret" in p
    p = problems(tmp_path, homelab=HOMELAB.replace('ssh_key = "~/.ssh/chiketi_homelab"',
                                                   'ssh_key = "-----BEGIN OPENSSH PRIVATE KEY-----"'))
    assert "server/homelab.toml: ssh_key" in p


def test_empty_required_values_rejected(tmp_path):
    p = problems(tmp_path, site=SITE.replace('user = "admin"', 'user = ""', 1))
    assert "server.user: must not be empty" in p
    kiosk = 'ssh = "admin@192.0.2.20"\nuser = '
    p = problems(tmp_path, site=SITE.replace(kiosk + '"admin"', kiosk + '""'))
    assert "display[0].user: must not be empty" in p


def test_token_file_value_checked(tmp_path):
    hl = HOMELAB + ('[[host]]\nname = "ha"\nkind = "http"\nurl = "http://192.0.2.23/"\n'
                    'token_file = """-----BEGIN PRIVATE KEY-----\nabc\n"""\n')
    assert "server/homelab.toml: host[1].token_file looks like a secret" in problems(tmp_path, homelab=hl)
