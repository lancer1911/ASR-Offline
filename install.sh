#!/bin/bash
# macOS 内置 bash 是 3.2（不支持 ${var,,} 等 bash4 语法）
# 本脚本已改写为兼容 bash 3.2 的写法，无需 Homebrew bash
# =============================================================================
#  Lancer1911 ASR Offline — 安装脚本
#  Install Script
#
#  用法 / Usage:
#    bash install.sh          # 标准安装（含 resemblyzer 说话人识别）
#    bash install.sh --no-diarize  # 跳过 resemblyzer（纯 MFCC 降级模式）
# =============================================================================

set -euo pipefail

# ── 颜色输出 ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
section() { echo -e "\n${BOLD}━━━  $*  ━━━${NC}"; }

# ── 参数解析 ─────────────────────────────────────────────────────────────────
INSTALL_DIARIZE=true
for arg in "$@"; do
    [[ "$arg" == "--no-diarize" ]] && INSTALL_DIARIZE=false
done

# ── 脚本所在目录（即 app 根目录） ────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# launcher.py 按此顺序查找：~/asr-offline-env, ~/asr-env
# 使用 asr-offline-env 以便与 ASR Live（如已安装）的环境隔离
VENV_DIR="$HOME/asr-offline-env"
PYTHON_MIN="3.11"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  Lancer1911 ASR Offline — Installer      ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
[[ "$INSTALL_DIARIZE" == false ]] && info "Mode: skip resemblyzer (MFCC fallback for diarization)"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
section "1 / 6  Hardware & OS Check"
# ═══════════════════════════════════════════════════════════════════════════════

# Apple Silicon
ARCH=$(uname -m)
if [[ "$ARCH" != "arm64" ]]; then
    error "This app requires Apple Silicon (M-series chip). Detected: $ARCH"
    exit 1
fi
ok "Apple Silicon detected"

# macOS version ≥ 13
OS_VER=$(sw_vers -productVersion)
OS_MAJOR=$(echo "$OS_VER" | cut -d. -f1)
if [[ "$OS_MAJOR" -lt 13 ]]; then
    error "macOS 13 Ventura or later required. Current: $OS_VER"
    exit 1
fi
ok "macOS $OS_VER"

# RAM ≥ 24 GB
RAM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
if [[ "$RAM_GB" -lt 24 ]]; then
    warn "Only ${RAM_GB} GB RAM detected. 24 GB minimum recommended."
    warn "The app may crash or run very slowly on this machine."
    read -r -p "Continue anyway? [y/N] " ans
    ans_lower=$(echo "$ans" | tr "[:upper:]" "[:lower:]")
    [[ "$ans_lower" == "y" ]] || exit 1
else
    ok "${RAM_GB} GB unified memory"
fi

# Disk space ≥ 15 GB free
FREE_GB=$(( $(df -k "$HOME" | tail -1 | awk '{print $4}') / 1024 / 1024 ))
if [[ "$FREE_GB" -lt 15 ]]; then
    error "Less than 15 GB free disk space (${FREE_GB} GB). Models require ~11 GB."
    exit 1
fi
ok "${FREE_GB} GB free disk space"

# ═══════════════════════════════════════════════════════════════════════════════
section "2 / 6  Homebrew & System Dependencies"
# ═══════════════════════════════════════════════════════════════════════════════

# Homebrew
if ! command -v brew &>/dev/null; then
    info "Homebrew not found — installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
fi
ok "Homebrew $(brew --version | head -1)"

# ffmpeg — required for MP3/MP4/AAC → 16kHz f32le conversion
# MP4 files contain AAC audio; ffmpeg decodes and resamples them.
# Without ffmpeg the file picker will fail with "ffmpeg 转换失败".
if ! command -v ffmpeg &>/dev/null; then
    info "Installing ffmpeg (required for MP3/MP4 audio decoding)..."
    brew install ffmpeg
fi
ok "ffmpeg $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"

# Verify ffmpeg has AAC decoding support (the aac decoder must be present)
if ! ffmpeg -decoders 2>/dev/null | grep -q " aac"; then
    warn "ffmpeg is installed but the AAC decoder was not found."
    warn "MP4 files may fail to load. Try: brew reinstall ffmpeg"
fi

# ═══════════════════════════════════════════════════════════════════════════════
section "3 / 6  Python Environment"
# ═══════════════════════════════════════════════════════════════════════════════

# Find Python 3.11+
PYTHON_BIN=""
for candidate in python3.13 python3.12 python3.11 python3; do
    if command -v "$candidate" &>/dev/null; then
        VER=$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
        MAJOR=$(echo "$VER" | cut -d. -f1)
        MINOR=$(echo "$VER" | cut -d. -f2)
        if [[ "$MAJOR" -ge 3 && "$MINOR" -ge 11 ]]; then
            PYTHON_BIN="$candidate"
            ok "Found Python $VER at $(command -v $candidate)"
            break
        fi
    fi
done

if [[ -z "$PYTHON_BIN" ]]; then
    info "Python $PYTHON_MIN+ not found — installing via Homebrew..."
    brew install python@3.11
    PYTHON_BIN="python3.11"
fi

# Create virtual environment at ~/asr-offline-env
# (launcher.py searches this path first, before ~/asr-env)
if [[ -d "$VENV_DIR" ]]; then
    warn "Virtual environment already exists at $VENV_DIR"
    read -r -p "Re-use existing environment? [Y/n] " ans
    if [[ "$(echo "$ans" | tr "[:upper:]" "[:lower:]")" == "n" ]]; then
        info "Removing old environment..."
        rm -rf "$VENV_DIR"
        "$PYTHON_BIN" -m venv "$VENV_DIR"
        ok "New virtual environment created at $VENV_DIR"
    else
        ok "Using existing environment"
    fi
else
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    ok "Virtual environment created at $VENV_DIR"
fi

# Activate
source "$VENV_DIR/bin/activate"
pip install --upgrade pip --quiet

# ═══════════════════════════════════════════════════════════════════════════════
section "4 / 6  Python Packages"
# ═══════════════════════════════════════════════════════════════════════════════

info "Installing core packages from requirements.txt (this may take 3–5 minutes)..."

# Install directly from requirements.txt so the script stays in sync
# with what the app actually depends on.
REQS="$SCRIPT_DIR/requirements.txt"
if [[ -f "$REQS" ]]; then
    pip install --quiet -r "$REQS"
    ok "Core packages installed (from requirements.txt)"
else
    # Fallback: explicit list matching requirements.txt as of v0.6n
    pip install --quiet \
        "fastapi>=0.111.0" \
        "uvicorn[standard]>=0.30.0" \
        "python-multipart>=0.0.9" \
        "pywebview>=5.1" \
        "mlx-whisper>=0.4.0" \
        "mlx-lm>=0.16.0" \
        "numpy>=1.26.0" \
        "scipy>=1.11.0" \
        "sounddevice>=0.4.7" \
        "onnxruntime"
    ok "Core packages installed (fallback list)"
fi

# resemblyzer — optional but strongly recommended for speaker diarization.
# Falls back to built-in MFCC automatically if not installed.
# Note: resemblyzer depends on webrtcvad which requires a C compiler.
# Xcode Command Line Tools (xcode-select --install) must be present.
if [[ "$INSTALL_DIARIZE" == true ]]; then
    info "Installing resemblyzer for speaker diarization..."
    if ! xcode-select -p &>/dev/null; then
        warn "Xcode Command Line Tools not found. resemblyzer requires them to compile webrtcvad."
        warn "Install with: xcode-select --install  then re-run this script."
        warn "Skipping resemblyzer — the app will use the built-in MFCC fallback."
    else
        pip install --quiet "resemblyzer>=0.1.1.dev0" || {
            warn "resemblyzer installation failed."
            warn "The app will use the built-in MFCC speaker embedding instead."
            warn "You can retry later: pip install resemblyzer"
        }
        ok "resemblyzer installed"
    fi
else
    info "Skipping resemblyzer (--no-diarize). Built-in MFCC will be used for speaker diarization."
fi

# ═══════════════════════════════════════════════════════════════════════════════
section "5 / 6  Model Downloads"
# ═══════════════════════════════════════════════════════════════════════════════

# huggingface_hub CLI
if ! command -v hf &>/dev/null; then
    pip install --quiet "huggingface_hub[cli]"
fi

HF_CACHE="$HOME/.cache/huggingface/hub"

download_model() {
    local repo="$1"
    local label="$2"
    local size="$3"
    local dir_name
    dir_name="models--$(echo "$repo" | tr '/' '--')"
    if [[ -d "$HF_CACHE/$dir_name" ]]; then
        ok "$label already cached — skipping"
    else
        info "Downloading $label ($size)..."
        info "  Tip: if slow, set HF_ENDPOINT=https://hf-mirror.com"
        hf download "$repo" || {
            warn "Download failed for $repo."
            warn "You can retry from the app Settings → Model Guide."
        }
    fi
}

# These are the default model IDs used by the app (server.py DEFAULT_SETTINGS).
# If the user has already configured different models in Settings, these
# downloads are still useful as the out-of-box defaults.
download_model "mlx-community/whisper-large-v3-turbo" "Whisper large-v3-turbo (ASR)" "~3 GB"
download_model "mlx-community/Qwen3-14B-4bit"         "Qwen3-14B-4bit (LLM)"        "~8 GB"

# ═══════════════════════════════════════════════════════════════════════════════
section "6 / 6  Launcher"
# ═══════════════════════════════════════════════════════════════════════════════

# The .app uses launcher.py to find an external Python environment.
# This .command file is only needed when running from source (not .app).
LAUNCHER="$HOME/Desktop/ASR Offline.command"
cat > "$LAUNCHER" << LAUNCH
#!/bin/bash
source "$VENV_DIR/bin/activate"
cd "$SCRIPT_DIR"
python main.py
LAUNCH
chmod +x "$LAUNCHER"
ok "Launcher created: ~/Desktop/ASR Offline.command"

# ── 完成 ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║   Installation complete ✓                ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  If running from source:"
echo -e "    Double-click: ${BOLD}~/Desktop/ASR Offline.command${NC}"
echo -e "    Or:           ${BOLD}source $VENV_DIR/bin/activate && python $SCRIPT_DIR/main.py${NC}"
echo ""
echo -e "  If running the .app:"
echo -e "    Just open ${BOLD}Lancer1911 ASR Offline.app${NC} — it will find $VENV_DIR automatically."
echo ""
if [[ "$INSTALL_DIARIZE" == false ]]; then
    echo -e "  Speaker diarization: using built-in MFCC (resemblyzer skipped)."
    echo -e "  To add resemblyzer later: ${BOLD}source $VENV_DIR/bin/activate && pip install resemblyzer${NC}"
fi
echo ""
