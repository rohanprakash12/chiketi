#!/usr/bin/env bash
# Chiketi installer — handles all prerequisites on Debian/Ubuntu
set -e

REPO="https://github.com/rohanprakash12/chiketi.git"

# Autostart choice: "" = ask, "yes" = install, "no" = skip. Flags let CI and
# provisioning scripts pick without a terminal.
AUTOSTART=""
for arg in "$@"; do
    case "$arg" in
        --autostart)    AUTOSTART="yes" ;;
        --no-autostart) AUTOSTART="no" ;;
        *) echo "Unknown option: $arg (expected --autostart or --no-autostart)" >&2 ;;
    esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Check OS ──
if [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091  # generated at runtime; not checkable here
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

# An array, not a string: a string would need unquoted expansion to split,
# which is the classic word-splitting bug shellcheck flags.
PKGS=()
command -v python3 >/dev/null || PKGS+=(python3)
command -v pip3 >/dev/null    || PKGS+=(python3-pip)
command -v git >/dev/null     || PKGS+=(git)
dpkg -s python3-venv >/dev/null 2>&1 || PKGS+=(python3-venv)

# psutil needs these to build
dpkg -s python3-dev >/dev/null 2>&1  || PKGS+=(python3-dev)
dpkg -s gcc >/dev/null 2>&1          || PKGS+=(gcc)

# Chromium for dashboard display
command -v chromium >/dev/null || command -v chromium-browser >/dev/null || command -v google-chrome >/dev/null || PKGS+=(chromium-browser)

if [ ${#PKGS[@]} -gt 0 ]; then
    info "Installing system packages: ${PKGS[*]}"
    sudo apt-get install -y -qq "${PKGS[@]}"
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
            # shellcheck disable=SC2016  # must land in the rc file unexpanded
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
            info "Added ~/.local/bin to PATH in $(basename "$SHELL_RC")"
        fi
    fi
fi

# ── Verify ──
if ! command -v chiketi >/dev/null 2>&1; then
    fail "Installation failed. Check errors above."
fi

# ── Optional: autostart on login ──
if [ -z "$AUTOSTART" ]; then
    # The documented entry point is `curl -fsSL ... | bash`, where STDIN is the
    # script itself -- a bare `read` would swallow the rest of this file. Ask the
    # terminal directly. Where there is no controlling terminal (CI, cron, a
    # non-interactive pipe) opening /dev/tty fails, so default to not installing
    # and say how to opt in.
    # The braces (not a subshell) keep fd 3 open in this shell, and put the
    # 2>/dev/null in effect BEFORE the inner redirection runs -- writing it as
    # `exec 3< /dev/tty 2>/dev/null` applies the redirections left to right, so
    # the failure message escapes to the real stderr.
    if { exec 3< /dev/tty; } 2>/dev/null; then
        printf "Enable autostart on login? [y/N] " > /dev/tty
        read -r reply <&3 || reply=""
        exec 3<&-
        case "$reply" in [Yy]*) AUTOSTART="yes" ;; *) AUTOSTART="no" ;; esac
    else
        AUTOSTART="no"
        warn "No terminal available; skipping autostart (re-run with --autostart)."
    fi
fi

AUTOSTART_FILE="$HOME/.config/autostart/chiketi.desktop"
if [ "$AUTOSTART" = "yes" ]; then
    mkdir -p "$(dirname "$AUTOSTART_FILE")"
    # Write the entry rather than copying scripts/chiketi.desktop: under
    # `curl | bash` the repo file is not on disk at all, and a copied
    # `Exec=chiketi` would rely on ~/.local/bin being on the graphical
    # session's PATH, which it usually is not. Resolve the binary now.
    CHIKETI_BIN="$(command -v chiketi)"
    # Unquoted heredoc so $CHIKETI_BIN expands; nothing else below contains
    # a $, backtick or backslash.
    cat > "$AUTOSTART_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Chiketi Dashboard
Comment=System stats dashboard for GeeekPi display
Exec=$CHIKETI_BIN
Terminal=false
Hidden=false
X-GNOME-Autostart-enabled=true
DESKTOP
    info "Autostart enabled ($AUTOSTART_FILE)"
else
    info "Autostart not enabled. Re-run the installer with --autostart to add it."
fi

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
