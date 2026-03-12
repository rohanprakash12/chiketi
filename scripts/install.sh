#!/usr/bin/env bash
# Chiketi installer — handles all prerequisites on Debian/Ubuntu
set -e

REPO="https://github.com/rohanprakash12/chiketi.git"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Check OS ──
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO="$ID"
else
    fail "Cannot detect OS. This installer supports Debian/Ubuntu."
fi

case "$DISTRO" in
    ubuntu|debian|pop|linuxmint|elementary) ;;
    *) warn "Untested distro: $DISTRO. Proceeding anyway (apt required)." ;;
esac

# ── System packages ──
info "Updating package lists..."
sudo apt-get update -qq

PKGS=""
command -v python3 >/dev/null || PKGS="$PKGS python3"
command -v pip3 >/dev/null    || PKGS="$PKGS python3-pip"
command -v git >/dev/null     || PKGS="$PKGS git"
dpkg -s python3-venv >/dev/null 2>&1 || PKGS="$PKGS python3-venv"

# psutil needs these to build
dpkg -s python3-dev >/dev/null 2>&1  || PKGS="$PKGS python3-dev"
dpkg -s gcc >/dev/null 2>&1          || PKGS="$PKGS gcc"

if [ -n "$PKGS" ]; then
    info "Installing system packages:$PKGS"
    sudo apt-get install -y -qq $PKGS
else
    info "System packages OK"
fi

# ── Check Python version ──
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)

if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 11 ]; }; then
    fail "Python 3.11+ required (found $PY_VER). Install a newer Python first."
fi
info "Python $PY_VER OK"

# ── Install pipx ──
if ! command -v pipx >/dev/null 2>&1; then
    info "Installing pipx..."
    python3 -m pip install --user pipx 2>/dev/null || sudo apt-get install -y -qq pipx
    python3 -m pipx ensurepath 2>/dev/null || true
    export PATH="$HOME/.local/bin:$PATH"
fi
info "pipx OK"

# ── Optional: NVIDIA GPU support ──
NVIDIA_FLAG=""
if command -v nvidia-smi >/dev/null 2>&1; then
    info "NVIDIA GPU detected — installing with GPU support"
    NVIDIA_FLAG="[nvidia]"
fi

# ── Install chiketi ──
info "Installing chiketi..."
if [ -n "$NVIDIA_FLAG" ]; then
    pipx install "chiketi[nvidia] @ git+${REPO}" --force
else
    pipx install "git+${REPO}" --force
fi

# ── Optional: lm-sensors for fan monitoring ──
if ! command -v sensors >/dev/null 2>&1; then
    info "Installing lm-sensors for fan monitoring..."
    sudo apt-get install -y -qq lm-sensors
fi

# ── Verify ──
if command -v chiketi >/dev/null 2>&1; then
    info "Installation complete!"
    echo ""
    echo "  Run:  chiketi"
    echo "  Control panel:  http://localhost:7777"
    echo ""
    echo "  Options:"
    echo "    chiketi --theme Panel/Gold"
    echo "    chiketi --theme Terminal/hacker"
    echo "    chiketi --theme Vintage/VFD"
    echo "    chiketi --rotate-interval 15"
    echo ""
else
    warn "chiketi not found in PATH. Try: export PATH=\"\$HOME/.local/bin:\$PATH\""
    warn "Then run: chiketi"
fi
