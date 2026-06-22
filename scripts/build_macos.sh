#!/usr/bin/env bash
# Build script for Qimchi macOS .app bundle and .dmg.
#
# Prerequisites (install once):
#   brew install create-dmg
#   # uv — https://docs.astral.sh/uv/getting-started/installation/
#   curl -LsSf https://astral.sh/uv/install.sh | sh
#
# Usage (from qimchi-react/ or from anywhere — the script resolves its own root):
#   bash scripts/build_macos.sh
#
# Output:
#   packaging/build/qimchi.app   -- the macOS .app bundle (from PyInstaller)
#   packaging/build/qimchi.dmg   -- installer disk image (from create-dmg)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

VERSION=$(grep 'version[[:space:]]*=' backend/pyproject.toml \
          | sed -E 's/.*version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/')
echo "Building Qimchi v$VERSION for macOS..."

# ── 1. Frontend ───────────────────────────────────────────────────────────────
echo "Building React frontend..."
cd frontend
npm install
npm run build
cd ..

# ── 2. Staging area ───────────────────────────────────────────────────────────
echo "Staging build files..."
mkdir -p packaging/build

# Copy canonical launcher (source of truth is packaging/qimchi_launcher.py).
cp packaging/qimchi_launcher.py packaging/build/qimchi_launcher.py

# Copy the .ico for Windows-style icon path used by the spec.
cp frontend/public/qimchi-logo.ico packaging/build/ 2>/dev/null || true

# Generate .icns from the .ico using macOS built-in tools (sips + iconutil).
# sips converts .ico -> base PNG; iconutil builds the multi-resolution .icns.
# Falls back gracefully -- the app still works without an icon.
ICO_SRC="frontend/public/qimchi-logo.ico"
ICNS_OUT="packaging/build/qimchi-logo.icns"
if [ -f "$ICO_SRC" ] && command -v sips &>/dev/null && command -v iconutil &>/dev/null; then
    ICONSET_PARENT="$(mktemp -d)"
    ICONSET="$ICONSET_PARENT/qimchi.iconset"
    mkdir -p "$ICONSET"
    BASE="$ICONSET/base.png"
    sips -s format png "$ICO_SRC" --out "$BASE" &>/dev/null || true
    if [ -f "$BASE" ]; then
        # iconutil requires these exact filenames and sizes.
        sips -z 16   16   "$BASE" --out "$ICONSET/icon_16x16.png"      &>/dev/null
        sips -z 32   32   "$BASE" --out "$ICONSET/icon_16x16@2x.png"   &>/dev/null
        sips -z 32   32   "$BASE" --out "$ICONSET/icon_32x32.png"      &>/dev/null
        sips -z 64   64   "$BASE" --out "$ICONSET/icon_32x32@2x.png"   &>/dev/null
        sips -z 128  128  "$BASE" --out "$ICONSET/icon_128x128.png"    &>/dev/null
        sips -z 256  256  "$BASE" --out "$ICONSET/icon_128x128@2x.png" &>/dev/null
        sips -z 256  256  "$BASE" --out "$ICONSET/icon_256x256.png"    &>/dev/null
        sips -z 512  512  "$BASE" --out "$ICONSET/icon_256x256@2x.png" &>/dev/null
        sips -z 512  512  "$BASE" --out "$ICONSET/icon_512x512.png"    &>/dev/null
        sips -z 1024 1024 "$BASE" --out "$ICONSET/icon_512x512@2x.png" &>/dev/null
        rm -f "$ICONSET/base.png"
        iconutil -c icns "$ICONSET" -o "$ICNS_OUT" \
            && echo "  Generated $ICNS_OUT" \
            || echo "  Warning: iconutil failed; app will launch without a dock icon"
    else
        echo "  Warning: sips could not convert $ICO_SRC; app will launch without a dock icon"
    fi
    rm -rf "$ICONSET_PARENT"
fi

BACKEND_STAGE="$REPO_ROOT/packaging/build/backend_src"
rm -rf "$BACKEND_STAGE"
mkdir -p "$BACKEND_STAGE"
cp backend/main.py "$BACKEND_STAGE/"
cp -r backend/api  "$BACKEND_STAGE/"
[ -f backend/.env ] && cp backend/.env "$BACKEND_STAGE/" || true
find "$BACKEND_STAGE" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# ── 3. fd binary ──────────────────────────────────────────────────────────────
# fd is bundled so users don't need it on PATH.  Binary is NOT committed
# (vendor/.gitignore excludes it); download once.
echo "Ensuring vendor/fd-macos/fd is present..."
mkdir -p vendor/fd-macos
FD_DEST="vendor/fd-macos/fd"

if [ ! -f "$FD_DEST" ]; then
    echo "  fd not found — downloading from GitHub releases..."

    ARCH=$(uname -m)
    FD_ARCH="aarch64-apple-darwin"
    [ "$ARCH" = "x86_64" ] && FD_ARCH="x86_64-apple-darwin"

    FD_JSON=$(curl -fsSL "https://api.github.com/repos/sharkdp/fd/releases/latest")
    ASSET_URL=$(echo "$FD_JSON" | python3 -c "
import sys, json
fd_arch = sys.argv[1]
data = json.load(sys.stdin)
assets = [a for a in data['assets']
          if fd_arch in a['name'] and a['name'].endswith('.tar.gz')]
if not assets:
    raise SystemExit('No fd asset found for arch: ' + fd_arch)
print(assets[0]['browser_download_url'])
" "$FD_ARCH")

    TMP=$(mktemp -d)
    curl -fsSL "$ASSET_URL" | tar -xz -C "$TMP"
    # Exclude man pages (*.1) — only pick the bare executable named "fd".
    FD_BIN=$(find "$TMP" -name "fd" -not -name "*.1" -type f | head -1)
    cp "$FD_BIN" "$FD_DEST"
    chmod +x "$FD_DEST"
    rm -rf "$TMP"
    echo "  Downloaded fd ($ARCH) to $FD_DEST"
else
    echo "  fd already at $FD_DEST"
fi

# ── 4. Python environment ─────────────────────────────────────────────────────
# Build from backend/.venv so the full dataset deps (netCDF4, h5py, polars, …)
# are present.  On macOS, pywebview uses the system WKWebView — no pythonnet.
echo "Setting up Python environment (backend/.venv)..."
PYTHON_EXE="backend/.venv/bin/python"
if [ ! -f "$PYTHON_EXE" ]; then
    uv venv --python 3.13 backend/.venv
fi

echo "Installing dependencies (backend + datasets extra + build tools)..."
uv pip install --python "$PYTHON_EXE" -e "./backend[datasets]"
uv pip install --python "$PYTHON_EXE" pyinstaller pywebview uvicorn

# ── 5. PyInstaller (.app bundle) ──────────────────────────────────────────────
echo "Building .app bundle with PyInstaller..."
"$PYTHON_EXE" -m PyInstaller \
    --clean --noconfirm \
    --distpath packaging/build \
    --workpath packaging/build/pyinstaller_work \
    packaging/qimchi.spec

APP_BUNDLE="packaging/build/qimchi.app"
if [ ! -d "$APP_BUNDLE" ]; then
    echo "Error: PyInstaller build failed — $APP_BUNDLE not found" >&2
    exit 1
fi
echo "Built $APP_BUNDLE"

# ── 6. DMG ────────────────────────────────────────────────────────────────────
# create-dmg produces a drag-to-Applications disk image with a standard layout:
#   left  = qimchi.app icon
#   right = /Applications symlink  (user drags app onto it to install)
echo "Creating DMG..."
DMG_OUT="packaging/build/qimchi.dmg"
rm -f "$DMG_OUT"

create-dmg \
    --volname "Qimchi $VERSION" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 128 \
    --icon "qimchi.app" 150 185 \
    --app-drop-link 450 185 \
    --hide-extension "qimchi.app" \
    "$DMG_OUT" \
    "$APP_BUNDLE"

DMG_MB=$(du -m "$DMG_OUT" | cut -f1)
echo "Built $REPO_ROOT/$DMG_OUT (${DMG_MB} MB)"
