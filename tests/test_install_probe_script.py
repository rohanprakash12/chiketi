"""scripts/install-probe.sh keeps the first authorized_keys backup of the day."""
from pathlib import Path

SCRIPT = (Path(__file__).resolve().parent.parent / "scripts" / "install-probe.sh").read_text()


def test_authorized_keys_backup_taken_once_per_day():
    assert "[ -e ~/.ssh/authorized_keys.bak-\\$d ] || cp -p ~/.ssh/authorized_keys" in SCRIPT
