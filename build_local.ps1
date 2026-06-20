$ErrorActionPreference = "Stop"

Write-Host "Building React Frontend..."
cd frontend
npm install
npm run build
cd ..

Write-Host "Creating packaging/build directory..."
New-Item -ItemType Directory -Force -Path packaging/build
Copy-Item frontend/public/qimchi-logo.ico packaging/build/

Write-Host "Copying canonical python launcher..."
# The launcher is committed at packaging/qimchi_launcher.py (source of truth).
Copy-Item packaging/qimchi_launcher.py packaging/build/qimchi_launcher.py -Force

Write-Host "Staging backend source (excluding venv/caches/logs)..."
# IMPORTANT: do NOT --add-data the whole backend/ folder
# Stage only the runtime source: main.py + the api package (+ .env if present).
$backendStage = Join-Path (Get-Location) "packaging\build\backend_src"
Remove-Item -Recurse -Force $backendStage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $backendStage | Out-Null
Copy-Item backend/main.py $backendStage/
Copy-Item -Recurse backend/api $backendStage/api
if (Test-Path backend/.env) { Copy-Item backend/.env $backendStage/ }
# Strip any bytecode caches that came along.
Get-ChildItem -Path $backendStage -Recurse -Force -Directory -Filter "__pycache__" |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Setting up Python environment (backend/.venv -- the complete env)..."
# Build from backend/.venv: it has the full runtime deps incl. the datasets
# extra (netCDF4, polars, h5py, h5netcdf, numcodecs). The root .venv is missing
# netCDF4/polars, so we deliberately do NOT use it.
$buildVenv = Join-Path (Get-Location) "backend\.venv"
$pythonExe = Join-Path $buildVenv "Scripts\python.exe"
if (!(Test-Path $pythonExe)) {
    uv venv --python 3.13 $buildVenv
}

Write-Host "Installing dependencies (backend + datasets extra + build tools)..."
# Editable backend WITH the datasets extra so NetCDF/HDF5/polars loaders work.
uv pip install --python $pythonExe -e ".\backend[datasets]"
# pythonnet is required by pywebview's EdgeChromium (WebView2) backend on Windows.
uv pip install --python $pythonExe pyinstaller pywebview pythonnet uvicorn

Write-Host "Building EXE with PyInstaller..."
$iconPath = Join-Path (Get-Location) "packaging\build\qimchi-logo.ico"
$frontendDist = Join-Path (Get-Location) "frontend\dist"
# Real backend dir (with main.py + api/) added to PyInstaller's module search
# path so it can ANALYZE the backend's import graph.
$backendPath = Join-Path (Get-Location) "backend"

# The launcher imports the backend dynamically (`from main import app`) and the
# backend ships as --add-data (data, not code), so PyInstaller's analyzer never
# sees `import plotly` etc. on its own. We therefore put the backend on --paths
# and force-analyze it via --hidden-import main + --collect-submodules api; that
# pulls in exactly the third-party deps actually imported (plotly, xarray,
# scipy, qcodes, ...) WITHOUT the test-suite bloat of --collect-all. The dataset
# backends are imported lazily inside functions, so we name them explicitly.
$pyiArgs = @(
    "--clean", "--noconfirm", "--onefile", "--windowed",
    "--icon=$iconPath",
    "--paths", "$backendPath",
    "--add-data", "$frontendDist;frontend/dist",
    "--add-data", "$backendStage;backend",
    "--hidden-import", "main",
    "--collect-submodules", "api",
    # qcodes has NO PyInstaller contrib hook (unlike plotly/xarray/scipy/...),
    # so its package DATA is not auto-collected. qcodes.configuration.config
    # reads qcodesrc.json + qcodesrc_schema.json via importlib.resources at
    # import time -- without them, `import qcodes` fails and .db loading 400s.
    # --collect-data ships those JSONs; --collect-submodules covers its dynamic
    # (sqlite storage / dataset) imports.
    "--collect-data", "qcodes",
    "--collect-submodules", "qcodes",
    "--hidden-import", "netCDF4",
    "--hidden-import", "h5netcdf",
    "--hidden-import", "h5py",
    "--hidden-import", "numcodecs",
    "--hidden-import", "polars",
    "--hidden-import", "uvicorn.logging",
    "--hidden-import", "uvicorn.loops",
    "--hidden-import", "uvicorn.loops.auto",
    "--hidden-import", "uvicorn.protocols",
    "--hidden-import", "uvicorn.protocols.http",
    "--hidden-import", "uvicorn.protocols.http.auto",
    "--hidden-import", "uvicorn.protocols.websockets",
    "--hidden-import", "uvicorn.protocols.websockets.auto",
    "--hidden-import", "uvicorn.lifespan",
    "--hidden-import", "uvicorn.lifespan.on",
    "--name", "qimchi",
    "--distpath", "packaging/build",
    "--workpath", "packaging/build/pyinstaller_work",
    "--specpath", "packaging/build",
    "packaging/build/qimchi_launcher.py"
)
& $pythonExe -m PyInstaller @pyiArgs

if (!(Test-Path "packaging/build/qimchi.exe")) { 
    throw "EXE build failed" 
}
$exeSize = (Get-Item "packaging/build/qimchi.exe").Length / 1MB
Write-Host "Successfully built qimchi.exe ($([math]::Round($exeSize, 2)) MB)"
Write-Host "You can find it at: $(Get-Location)\packaging\build\qimchi.exe"
