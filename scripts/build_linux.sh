#!/usr/bin/env bash
# Build script for Qimchi Linux AppImage (PyInstaller + pywebview GTK).
#
# Prerequisites (install once, Debian/Ubuntu):
#   sudo apt-get install -y libgirepository1.0-dev gcc pkg-config libcairo2-dev \
#       gir1.2-gtk-3.0 gir1.2-webkit2-4.0 libwebkit2gtk-4.0-dev \
#       patchelf squashfs-tools imagemagick
#   curl -LsSf https://astral.sh/uv/install.sh | sh
#
# Usage (from qimchi-react/ or anywhere -- the script resolves its own root):
#   bash scripts/build_linux.sh
#
# Output:
#   packaging/build/qimchi-x86_64.AppImage   (or aarch64)
#
# Runtime requirement on the user's machine:
#   libwebkit2gtk-4.0 or libwebkit2gtk-4.1 (pywebview GTK backend)
#   Ubuntu/Debian: sudo apt-get install libwebkit2gtk-4.0-37
#   Fedora:        sudo dnf install webkit2gtk4.0
#   Arch:          sudo pacman -S webkit2gtk
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

VERSION=$(grep 'version[[:space:]]*=' backend/pyproject.toml \
          | sed -E 's/.*version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/')
echo "Building Qimchi v$VERSION for Linux..."

# ── 1. Frontend ───────────────────────────────────────────────────────────────
echo "Building React frontend..."
cd frontend
npm install
npm run build
cd ..

# ── 2. Staging area ───────────────────────────────────────────────────────────
echo "Staging build files..."
mkdir -p packaging/build

cp packaging/qimchi_launcher.py packaging/build/qimchi_launcher.py
cp frontend/public/qimchi-logo.ico packaging/build/ 2>/dev/null || true

BACKEND_STAGE="$REPO_ROOT/packaging/build/backend_src"
rm -rf "$BACKEND_STAGE"
mkdir -p "$BACKEND_STAGE"
cp backend/main.py "$BACKEND_STAGE/"
cp -r backend/api  "$BACKEND_STAGE/"
[ -f backend/.env ] && cp backend/.env "$BACKEND_STAGE/" || true
find "$BACKEND_STAGE" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# ── 3. fd binary ──────────────────────────────────────────────────────────────
echo "Ensuring vendor/fd-linux/fd is present..."
mkdir -p vendor/fd-linux
FD_DEST="vendor/fd-linux/fd"

if [ ! -f "$FD_DEST" ]; then
    echo "  fd not found -- downloading from GitHub releases..."
    ARCH=$(uname -m)
    FD_ARCH="x86_64-unknown-linux-musl"
    [ "$ARCH" = "aarch64" ] && FD_ARCH="aarch64-unknown-linux-musl"

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
    FD_BIN=$(find "$TMP" -name "fd" -not -name "*.1" -type f | head -1)
    cp "$FD_BIN" "$FD_DEST"
    chmod +x "$FD_DEST"
    rm -rf "$TMP"
    echo "  Downloaded fd ($ARCH) to $FD_DEST"
else
    echo "  fd already at $FD_DEST"
fi

# ── 4. Python environment ─────────────────────────────────────────────────────
echo "Setting up Python environment (backend/.venv)..."
PYTHON_EXE="backend/.venv/bin/python"
if [ ! -f "$PYTHON_EXE" ]; then
    uv venv --python 3.13 backend/.venv
fi

echo "Installing dependencies (backend + datasets extra + build tools)..."
uv pip install --python "$PYTHON_EXE" -e "./backend[datasets]"
# pygobject: Python bindings for GLib/GTK/WebKit2GTK (pywebview GTK backend).
# Requires system headers at build time: libgirepository1.0-dev, libcairo2-dev.
# Requires system libs at runtime: libwebkit2gtk-4.0 or libwebkit2gtk-4.1.
uv pip install --python "$PYTHON_EXE" pyinstaller pywebview uvicorn pygobject

# ── 5. PyInstaller (onedir) ───────────────────────────────────────────────────
echo "Building onedir app with PyInstaller..."
"$PYTHON_EXE" -m PyInstaller \
    --clean --noconfirm \
    --distpath packaging/build \
    --workpath packaging/build/pyinstaller_work \
    packaging/qimchi.spec

APP_DIR="packaging/build/qimchi"
APP_BIN="$APP_DIR/qimchi"
if [ ! -f "$APP_BIN" ]; then
    echo "Error: PyInstaller build failed -- $APP_BIN not found" >&2
    exit 1
fi
APP_SIZE_MB=$(du -sm "$APP_DIR" | cut -f1)
echo "Built $APP_DIR (${APP_SIZE_MB} MB total)"

# ── 6. AppImage ───────────────────────────────────────────────────────────────
echo "Packaging AppImage..."
ARCH=$(uname -m)
APPDIR="packaging/build/Qimchi.AppDir"
APPIMAGE_OUT="packaging/build/qimchi-${ARCH}.AppImage"
rm -rf "$APPDIR" "$APPIMAGE_OUT"
mkdir -p "$APPDIR"

# Copy the PyInstaller onedir output flat into AppDir.
cp -r "$APP_DIR"/. "$APPDIR/"

# AppRun -- entry point called by the AppImage runtime.
cat > "$APPDIR/AppRun" << 'APPRUN'
#!/usr/bin/env bash
APPDIR="$(dirname "$(readlink -f "${0}")")"
exec "$APPDIR/qimchi" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"

# .desktop file required by the AppImage spec.
cat > "$APPDIR/qimchi.desktop" << DESKTOP
[Desktop Entry]
Version=1.0
Name=Qimchi
Comment=Quantum measurement data visualisation
Exec=qimchi
Icon=qimchi
Terminal=false
Type=Application
Categories=Science;Education;
DESKTOP

# Icon: extract the first image from the .ico as PNG if ImageMagick is
# available; otherwise copy the .ico directly (appimagetool accepts both).
if command -v convert &>/dev/null && [ -f "packaging/build/qimchi-logo.ico" ]; then
    convert "packaging/build/qimchi-logo.ico[0]" "$APPDIR/qimchi.png" 2>/dev/null \
        && echo "  Extracted PNG icon to $APPDIR/qimchi.png" \
        || cp "packaging/build/qimchi-logo.ico" "$APPDIR/qimchi.png"
elif [ -f "packaging/build/qimchi-logo.ico" ]; then
    cp "packaging/build/qimchi-logo.ico" "$APPDIR/qimchi.png"
fi

# Download appimagetool if not present (cached in vendor/appimagetool/).
APPIMAGETOOL_DIR="vendor/appimagetool"
mkdir -p "$APPIMAGETOOL_DIR"
APPIMAGETOOL="$APPIMAGETOOL_DIR/appimagetool-${ARCH}.AppImage"

if [ ! -f "$APPIMAGETOOL" ]; then
    echo "  appimagetool not found -- downloading..."
    curl -fsSL -o "$APPIMAGETOOL" \
        "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage"
    chmod +x "$APPIMAGETOOL"
    echo "  Downloaded appimagetool to $APPIMAGETOOL"
fi

# --appimage-extract-and-run: avoids FUSE (works in Docker CI and unprivileged hosts).
# --no-appstream: skip appstream validation (no AppStream metadata yet).
ARCH="$ARCH" "$APPIMAGETOOL" \
    --appimage-extract-and-run --no-appstream \
    "$APPDIR" "$APPIMAGE_OUT"

APPIMAGE_MB=$(du -m "$APPIMAGE_OUT" | cut -f1)
echo "Built $REPO_ROOT/$APPIMAGE_OUT (${APPIMAGE_MB} MB)"
