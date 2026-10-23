#!/usr/bin/env bash
# Install chiketi-probe on one Linux host and let the chiketi server's key run ONLY it.
# Usage: HUB=user@chiketi-server ./scripts/install-probe.sh user@host
#   HUB is the machine running chiketi with the Home Lab screen; it holds the
#   key ~/.ssh/chiketi_homelab (create it there first with ssh-keygen).
set -euo pipefail
TARGET=$1
HUB=${HUB:?set HUB=user@chiketi-server}
SRC=${SRC:-$(cd "$(dirname "$0")/.." && pwd)/chiketi/assets/probe}
PUB=$(ssh "$HUB" cat .ssh/chiketi_homelab.pub)
scp -q "$SRC/chiketi-probe" "$SRC/smart-read" "$TARGET:/tmp/"
# $PUB is meant to expand here, on this machine.
# shellcheck disable=SC2029
ssh "$TARGET" "set -e
  d=\$(date +%Y%m%d); u=\$(id -un)
  command -v smartctl >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq smartmontools >/dev/null 2>&1
  sudo install -m755 /tmp/chiketi-probe /usr/local/bin/chiketi-probe
  sudo install -D -m755 /tmp/smart-read /usr/local/lib/chiketi-probe/smart-read
  rm -f /tmp/chiketi-probe /tmp/smart-read
  echo \"\$u ALL=(root) NOPASSWD: /usr/local/lib/chiketi-probe/smart-read\" | sudo tee /etc/sudoers.d/91-chiketi-probe >/dev/null
  sudo chmod 440 /etc/sudoers.d/91-chiketi-probe && sudo visudo -cf /etc/sudoers.d/91-chiketi-probe >/dev/null
  mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys
  [ -e ~/.ssh/authorized_keys.bak-\$d ] || cp -p ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak-\$d
  grep -qF 'chiketi-homelab@' ~/.ssh/authorized_keys ||
    echo 'command=\"/usr/local/bin/chiketi-probe\",restrict $PUB' >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  /usr/local/bin/chiketi-probe | head -3"
# Pin the host key into the chiketi server's known_hosts (first contact, from inside the LAN).
HOSTPART=${TARGET#*@}
# $HOSTPART is meant to expand here, on this machine.
# shellcheck disable=SC2029
ssh "$HUB" "touch ~/.config/chiketi/homelab_known_hosts
  ssh-keygen -F '$HOSTPART' -f ~/.config/chiketi/homelab_known_hosts >/dev/null ||
    ssh-keyscan -t ed25519 '$HOSTPART' 2>/dev/null >> ~/.config/chiketi/homelab_known_hosts
  ssh -i ~/.ssh/chiketi_homelab -o BatchMode=yes -o StrictHostKeyChecking=yes \
      -o UserKnownHostsFile=~/.config/chiketi/homelab_known_hosts ${TARGET} anything-at-all | head -2"
