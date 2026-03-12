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

# Chromium for dashboard display
command -v chromium >/dev/null || command -v chromium-browser >/dev/null || command -v google-chrome >/dev/null || PKGS="$PKGS chromium-browser"

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

# ── Upgrade pip/setuptools inside pipx's build environment ──
info "Ensuring pip and setuptools are up to date..."
python3 -m pip install --user --upgrade pip setuptools wheel 2>/dev/null || true

# ── Install chiketi ──
info "Installing chiketi..."
if [ -n "$NVIDIA_FLAG" ]; then
    pipx install "chiketi[nvidia] @ git+${REPO}" --force --pip-args="--upgrade-strategy eager"
else
    pipx install "git+${REPO}" --force --pip-args="--upgrade-strategy eager"
fi

# ── Optional: lm-sensors for fan monitoring ──
if ! command -v sensors >/dev/null 2>&1; then
    info "Installing lm-sensors for fan monitoring..."
    sudo apt-get install -y -qq lm-sensors
fi

# ── Fix PATH ──
PIPX_BIN="$HOME/.local/bin"
if ! echo "$PATH" | grep -q "$PIPX_BIN"; then
    export PATH="$PIPX_BIN:$PATH"
    # Add to shell profile permanently
    SHELL_RC=""
    if [ -f "$HOME/.bashrc" ]; then
        SHELL_RC="$HOME/.bashrc"
    elif [ -f "$HOME/.zshrc" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -f "$HOME/.profile" ]; then
        SHELL_RC="$HOME/.profile"
    fi
    if [ -n "$SHELL_RC" ]; then
        if ! grep -q '.local/bin' "$SHELL_RC" 2>/dev/null; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
            info "Added ~/.local/bin to PATH in $(basename $SHELL_RC)"
        fi
    fi
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
    echo "  If 'chiketi' is not found, open a new terminal and try again."
    echo ""
else
    fail "Installation failed. Check errors above."
fi
