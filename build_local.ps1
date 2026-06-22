$ErrorActionPreference = "Stop"

# Extract version from pyproject.toml for use in the installer filename/metadata.
$VERSION = (Select-String -Path "backend/pyproject.toml" -Pattern 'version\s*=\s*"([^"]+)"').Matches.Groups[1].Value
Write-Host "Building Qimchi v$VERSION..."

# ── 1. Frontend ───────────────────────────────────────────────────────────────
Write-Host "Building React frontend..."
cd frontend
npm install
npm run build
cd ..

# ── 2. Staging area ───────────────────────────────────────────────────────────
Write-Host "Creating packaging/build directory..."
New-Item -ItemType Directory -Force -Path packaging/build | Out-Null
Copy-Item frontend/public/qimchi-logo.ico packaging/build/

Write-Host "Copying canonical python launcher..."
# The launcher is committed at packaging/qimchi_launcher.py (source of truth).
Copy-Item packaging/qimchi_launcher.py packaging/build/qimchi_launcher.py -Force

Write-Host "Staging backend source (excluding venv/caches/logs)..."
# IMPORTANT: do NOT --add-data the whole backend/ folder.
# Stage only the runtime source: main.py + the api package (+ .env if present).
$backendStage = Join-Path (Get-Location) "packaging\build\backend_src"
Remove-Item -Recurse -Force $backendStage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $backendStage | Out-Null
Copy-Item backend/main.py $backendStage/
Copy-Item -Recurse backend/api $backendStage/api
if (Test-Path backend/.env) { Copy-Item backend/.env $backendStage/ }
Get-ChildItem -Path $backendStage -Recurse -Force -Directory -Filter "__pycache__" |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# ── 3. fd binary ──────────────────────────────────────────────────────────────
# fd is bundled into the PyInstaller package so users don't need it on PATH.
# The binary is NOT committed (vendor/.gitignore excludes it); download it once.
Write-Host "Ensuring vendor/fd-windows/fd.exe is present..."
New-Item -ItemType Directory -Force -Path "vendor\fd-windows" | Out-Null
$fdDest = "vendor\fd-windows\fd.exe"
if (!(Test-Path $fdDest)) {
    Write-Host "  fd.exe not found -- downloading from GitHub releases..."
    try {
        $rel   = Invoke-RestMethod "https://api.github.com/repos/sharkdp/fd/releases/latest"
        $asset = $rel.assets | Where-Object {
            $_.name -like "*x86_64-pc-windows-msvc*" -and $_.name -like "*.zip"
        } | Select-Object -First 1
        if (!$asset) { throw "Could not locate fd Windows asset in latest release." }

        $zipTemp     = Join-Path $env:TEMP "fd-windows.zip"
        $extractTemp = Join-Path $env:TEMP "fd-extract"
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipTemp
        Expand-Archive $zipTemp -DestinationPath $extractTemp -Force
        $fdExe = Get-ChildItem -Path $extractTemp -Recurse -Filter "fd.exe" | Select-Object -First 1
        Copy-Item $fdExe.FullName $fdDest -Force
        Remove-Item $zipTemp       -Force -ErrorAction SilentlyContinue
        Remove-Item $extractTemp   -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  Downloaded fd.exe ($([math]::Round((Get-Item $fdDest).Length / 1KB, 0)) KB) to $fdDest"
    } catch {
        Write-Warning "  Failed to download fd.exe: $_"
        Write-Warning "  Explorer's directory tree will not work in the packaged app."
        Write-Warning "  Place fd.exe manually at $fdDest and re-run to fix."
    }
} else {
    Write-Host "  fd.exe already present at $fdDest"
}

# ── 4. Python environment ─────────────────────────────────────────────────────
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

# ── 5. PyInstaller (onedir) ───────────────────────────────────────────────────
Write-Host "Building onedir app with PyInstaller..."
# Uses the canonical spec at packaging/qimchi.spec (committed; portable paths).
# Output: packaging/build/qimchi/           <-- COLLECT output dir
#           qimchi.exe
#           _internal/  (Python runtime, deps, fd.exe, frontend/backend data)
$pyiArgs = @(
    "--clean", "--noconfirm",
    "--distpath", "packaging/build",
    "--workpath", "packaging/build/pyinstaller_work",
    "packaging/qimchi.spec"
)
& $pythonExe -m PyInstaller @pyiArgs

$appDir = "packaging/build/qimchi"
$appExe = "$appDir/qimchi.exe"
if (!(Test-Path $appExe)) {
    throw "PyInstaller build failed -- $appExe not found"
}
$dirSize = (Get-ChildItem -Recurse $appDir | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host "Built $appDir ($([math]::Round($dirSize, 0)) MB total)"

# ── 6. Inno Setup installer ───────────────────────────────────────────────────
Write-Host "Building Inno Setup installer..."
# Locate ISCC.exe (installed by choco install innosetup or manually).
$isccExe = $null
# Windows PowerShell 5.1 (the CI runner's shell) has no ?. operator, so resolve
# the ISCC.exe command separately before building the candidate list.
$isccCmd = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
$isccCandidates = @(
    $(if ($isccCmd) { $isccCmd.Source }),
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
)
foreach ($cand in $isccCandidates) {
    if ($cand -and (Test-Path $cand)) { $isccExe = $cand; break }
}

if (!$isccExe) {
    Write-Warning "ISCC.exe not found -- skipping installer build."
    Write-Warning "Install Inno Setup 6 (https://jrsoftware.org/isinfo.php or: choco install innosetup) then re-run."
    Write-Host "Packaged app is at: $(Get-Location)\$appDir"
} else {
    # /Q = quiet (no progress window); /DAppVersion passes the version to the script.
    & $isccExe "/DAppVersion=$VERSION" "/Q" "packaging\setup.iss"
    $installerPath = "packaging\build\qimchi-setup.exe"
    if (!(Test-Path $installerPath)) {
        throw "Inno Setup build failed -- $installerPath not found"
    }
    $installerSize = (Get-Item $installerPath).Length / 1MB
    Write-Host "Installer: $(Get-Location)\$installerPath ($([math]::Round($installerSize, 0)) MB)"
}
