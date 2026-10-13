#!/usr/bin/env bash
# AegiSec one-click launcher (Linux/macOS)
# Developed by Kranthi Yelaboina
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d "packages/aegisec" ]; then
    echo "[!] Cannot find packages/aegisec - run this script from the repository root."
    exit 1
fi

echo "=================================================="
echo "           A E G I S E C"
echo "    The open source AI security agent"
echo "       Developed by Kranthi Yelaboina"
echo "=================================================="
echo

# ── Step 1: Ensure Bun runtime is available ─────────────────────────
if command -v bun >/dev/null 2>&1; then
    echo "[OK] Bun $(bun --version) found."
elif [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
    echo "[OK] Bun $(bun --version) found in ~/.bun/bin."
else
    echo "[..] Bun not found. Downloading and installing..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    echo "[OK] Bun $(bun --version) installed."
fi

# ── Step 2: Ensure Node.js toolchain is available ───────────────────
# Needed once to compile native modules (node-pty, tree-sitter) on first install.
NODE_DIR="$HOME/.local/aegisec-node"
if ! command -v node >/dev/null 2>&1; then
    if [ -x "$NODE_DIR/bin/node" ]; then
        export PATH="$NODE_DIR/bin:$PATH"
        echo "[OK] Local Node.js $(node --version) found."
    else
        case "$(uname -m)" in
            x86_64)  NODE_ARCH="x64" ;;
            aarch64|arm64) NODE_ARCH="arm64" ;;
            *) echo "[!] Unsupported architecture $(uname -m) - install Node.js manually."; exit 1 ;;
        esac
        echo "[..] Node.js not found. Installing locally to ~/.local/aegisec-node ..."
        mkdir -p "$NODE_DIR"
        curl -fsSL "https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-${NODE_ARCH}.tar.xz" \
            | tar -xJ -C "$NODE_DIR" --strip-components=1
        export PATH="$NODE_DIR/bin:$PATH"
        echo "[OK] Node.js $(node --version) installed."
    fi
else
    echo "[OK] Node.js $(node --version) found."
fi

# ── Step 3: Install project dependencies (first run only) ───────────
if [ -d "node_modules" ]; then
    echo "[OK] Project dependencies already installed."
else
    echo "[..] Installing project dependencies. First run only - please wait..."
    echo
    bun install
fi
echo

# ── Step 4: Launch AegiSec TUI ──────────────────────────────────────
echo "[..] Starting AegiSec..."
echo
exec bun run --cwd packages/aegisec --conditions=browser src/index.ts "$@"
