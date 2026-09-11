# -*- mode: python ; coding: utf-8 -*-
"""
Canonical PyInstaller spec for Qimchi desktop (onedir build).

Windows / Linux — produces packaging/build/qimchi/ (COLLECT onedir):
    qimchi.exe          -- the launcher
    _internal/          -- Python runtime, all deps, bundled fd, frontend/backend

macOS — produces packaging/build/qimchi/ (COLLECT) AND packaging/build/qimchi.app
    (BUNDLE wrapping the COLLECT).  Distribute the .app; the bare directory is
    an intermediate artefact used only by DMG packaging.

sys._MEIPASS inside a frozen build points to _internal/, so config.py finds
fd via  os.path.join(sys._MEIPASS, "fd[.exe]")  in both modes.

Build:
    Windows:  scripts/build_windows.ps1
    macOS:    scripts/build_macos.sh
    Direct:   pyinstaller --clean --noconfirm \
                  --distpath packaging/build \
                  --workpath packaging/build/pyinstaller_work \
                  packaging/qimchi.spec

Prerequisites (set up by the build scripts before calling this spec):
    packaging/build/backend_src/       -- staged backend (main.py + api/)
    packaging/build/qimchi-logo.ico    -- Windows/Linux icon
    packaging/build/qimchi-logo.icns   -- macOS icon (optional; omitted = no icon)
    packaging/build/qimchi_launcher.py
    frontend/dist/                     -- built SPA
    vendor/fd-windows/fd.exe           -- Windows fd binary
    vendor/fd-macos/fd                 -- macOS fd binary
"""

import os
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

# All paths are derived from the spec file location so the spec is portable
# across machines (no hardcoded absolute paths).
_spec_dir = os.path.dirname(os.path.abspath(SPEC))   # qimchi-react/packaging/
_repo_root = os.path.dirname(_spec_dir)               # qimchi-react/
_build_dir = os.path.join(_spec_dir, "build")

_frontend_dist = os.path.join(_repo_root, "frontend", "dist")
_backend_stage = os.path.join(_build_dir, "backend_src")
_icon_path     = os.path.join(_build_dir, "qimchi-logo.ico")
_icon_macos    = os.path.join(_build_dir, "qimchi-logo.icns")
_launcher_path = os.path.join(_build_dir, "qimchi_launcher.py")

# Pick the right icon list for the current platform.
# macOS uses .icns (optional — omit if not yet created).
# Windows/.ico is always passed; Linux ignores the icon arg silently.
if sys.platform == "darwin":
    _icons = [_icon_macos] if os.path.isfile(_icon_macos) else []
else:
    _icons = [_icon_path]

# UPX is unreliable on macOS (arm64 in particular); disable it there.
_use_upx = sys.platform != "darwin"

# fd binary: vendor/<platform>/fd[.exe]
# Only Windows is packaged today; Linux/macOS stubs are for future use.
# build_windows.ps1 / CI download the binary before invoking PyInstaller.
_fd_by_platform = {
    "win32":  os.path.join(_repo_root, "vendor", "fd-windows", "fd.exe"),
    "linux":  os.path.join(_repo_root, "vendor", "fd-linux",   "fd"),
    "darwin": os.path.join(_repo_root, "vendor", "fd-macos",   "fd"),
}
_fd_src = _fd_by_platform.get(sys.platform, "")

datas = [
    (_frontend_dist, "frontend/dist"),
    (_backend_stage, "backend"),
]
datas += collect_data_files("qcodes")
# copy_metadata ensures importlib.metadata.version("qimchi-api") works in the
# frozen build so the updater can compare the running version against releases.
datas += copy_metadata("qimchi-api")

# Alembic migrations are loaded from the filesystem by path (not imported), so
# they must be bundled as data at _internal/migrations/. api/shared/db.py's
# run_migrations() resolves them via sys._MEIPASS/migrations when frozen.
datas += [(os.path.join(_repo_root, "backend", "migrations"), "migrations")]
# Some DB deps read their own package metadata at import time.
for _pkg in ("alembic", "sqlalchemy", "sqlmodel", "mako"):
    try:
        datas += copy_metadata(_pkg)
    except Exception:
        pass

hiddenimports = [
    "main",
    "netCDF4",
    "h5netcdf",
    "h5py",
    "numcodecs",
    "polars",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
]
hiddenimports += collect_submodules("api")
hiddenimports += collect_submodules("qcodes")
# DB stack: alembic + sqlalchemy pull dialects/migration modules dynamically;
# greenlet + mako are imported indirectly. Collect them so the frozen app can
# run migrations on startup.
hiddenimports += collect_submodules("alembic")
hiddenimports += collect_submodules("sqlalchemy")
hiddenimports += ["sqlmodel", "greenlet", "mako", "mako.template"]
# pywebview loads its platform backend dynamically; name it explicitly so
# PyInstaller includes it.
if sys.platform == "linux":
    hiddenimports += ["webview.platforms.gtk"]
elif sys.platform == "darwin":
    hiddenimports += ["webview.platforms.cocoa"]

# Bundle fd alongside Python binaries so it lands in sys._MEIPASS (_internal/).
# config.py finds it via os.path.join(sys._MEIPASS, "fd[.exe]") when frozen.
# Destination "." = root of _MEIPASS, i.e. _internal/ in onedir mode.
binaries = []
if _fd_src and os.path.isfile(_fd_src):
    binaries.append((_fd_src, "."))

a = Analysis(
    [_launcher_path],
    pathex=[os.path.join(_repo_root, "backend")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,  # onedir: binaries go to COLLECT, not packed into exe
    name="qimchi",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=_use_upx,
    upx_exclude=[],
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_icons,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=_use_upx,
    upx_exclude=[],
    name="qimchi",
)

if sys.platform == "darwin":
    import tomllib  # stdlib since Python 3.11

    with open(os.path.join(_repo_root, "backend", "pyproject.toml"), "rb") as _f:
        _version = tomllib.load(_f)["project"]["version"]

    app = BUNDLE(
        coll,
        name="qimchi.app",
        icon=_icons[0] if _icons else None,
        bundle_identifier="ac.niser.qimchi",
        info_plist={
            "CFBundleName": "Qimchi",
            "CFBundleDisplayName": "Qimchi",
            "CFBundleIdentifier": "ac.niser.qimchi",
            "CFBundleVersion": _version,
            "CFBundleShortVersionString": _version,
            "NSHighResolutionCapable": True,
            # False = respect the system dark/light mode via WKWebView.
            "NSRequiresAquaSystemAppearance": False,
            "LSApplicationCategoryType": "public.app-category.developer-tools",
            # Allow WKWebView to reach the local uvicorn server on 127.0.0.1.
            "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
        },
    )
