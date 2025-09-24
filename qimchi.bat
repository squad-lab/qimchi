@echo off
REM ============================================================================
REM QIMCHI Windows Setup and Run Script
REM
REM This script will:
REM 1. Check for existing installation and skip setup if found
REM 2. Check and install Git via winget if not present
REM 3. Clone or update QIMCHI repository to %USERPROFILE%\.qimchi
REM 4. Check and install Python dependencies (uv)
REM 5. Install Node.js via winget if not present
REM 6. Install fd-find for better performance (optional)
REM 7. Install Python backend dependencies using uv
REM 8. Install and build React frontend using npm
REM 9. Start the FastAPI server with static file serving
REM
REM Usage: Double-click this file or run from command prompt
REM The web interface will be available at http://localhost:8001
REM 
REM To force a fresh installation, delete: %USERPROFILE%\.qimchi\.qimchi_installed
REM ============================================================================

setlocal EnableDelayedExpansion

echo ============================================
echo          QIMCHI Setup and Run Script
echo ============================================
echo.

:: Check if Git is installed, install if not
git --version >nul 2>&1
if errorlevel 1 (
    echo Git not found. Installing via winget...
    winget install Git.Git
    if errorlevel 1 (
        echo ERROR: Failed to install Git via winget
        echo Please install Git manually and try again
        pause
        exit /b 1
    )
    echo Git installed successfully. Please restart this script to refresh PATH.
    pause
    exit /b 0
) else (
    echo Git is already installed
)

:: Set up .qimchi directory in user home
set QIMCHI_DIR=%USERPROFILE%\.qimchi
set INSTALL_MARKER=%QIMCHI_DIR%\.qimchi_installed
echo Setting up QIMCHI in: %QIMCHI_DIR%

:: Check if installation is already complete
if exist "%INSTALL_MARKER%" (
    echo.
    echo ============================================
    echo     QIMCHI Already Installed - Quick Start
    echo ============================================
    echo Previous installation detected. Checking if everything is ready...
    
    :: Verify all components exist
    if exist "%QIMCHI_DIR%\qimchi-react\backend\main.py" (
        if exist "%QIMCHI_DIR%\qimchi-react\frontend\dist\index.html" (
            echo Installation verified. Checking for updates...
            cd /d "%QIMCHI_DIR%\qimchi-react"
            git pull origin main >nul 2>&1
            if errorlevel 1 (
                echo Warning: Could not update repository. Using existing version.
            ) else (
                echo Repository updated successfully.
            )
            echo Starting server directly...
            goto :start_server
        )
    )
    
    echo Installation incomplete or corrupted. Re-running setup...
    del "%INSTALL_MARKER%" 2>nul
)

:: Create .qimchi directory if it doesn't exist
if not exist "%QIMCHI_DIR%" (
    echo Creating .qimchi directory...
    mkdir "%QIMCHI_DIR%"
)

:: Check if qimchi-react already exists, if not clone it
if not exist "%QIMCHI_DIR%\qimchi-react" (
    echo Cloning QIMCHI repository...
    cd /d "%QIMCHI_DIR%"
    git clone https://gitlab.com/squad-lab/qimchi-react.git
    if errorlevel 1 (
        echo ERROR: Failed to clone repository
        echo Please check your internet connection and try again
        pause
        exit /b 1
    )
    echo Repository cloned successfully
) else (
    echo Repository already exists. Updating...
    cd /d "%QIMCHI_DIR%\qimchi-react"
    git pull origin main
    if errorlevel 1 (
        echo Warning: Failed to update repository. Continuing with existing version...
    ) else (
        echo Repository updated successfully
    )
)

:: Navigate to the cloned repository
cd /d "%QIMCHI_DIR%\qimchi-react"
if errorlevel 1 (
    echo ERROR: Could not navigate to cloned repository
    pause
    exit /b 1
)

echo Current directory: %CD%
echo.

:: Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.13 or later and try again
    pause
    exit /b 1
)

:: Check if uv is installed, install if not
uv --version >nul 2>&1
if errorlevel 1 (
    echo Installing uv...
    python -m pip install uv
    if errorlevel 1 (
        echo ERROR: Failed to install uv
        pause
        exit /b 1
    )
) else (
    echo uv is already installed
)

:: Check if Node.js is installed, install if not
node --version >nul 2>&1
if errorlevel 1 (
    echo Node.js not found. Installing via winget...
    winget install OpenJS.NodeJS
    if errorlevel 1 (
        echo ERROR: Failed to install Node.js via winget
        echo Please install Node.js manually and try again
        pause
        exit /b 1
    )
    echo Please restart this script after Node.js installation completes
    pause
    exit /b 0
) else (
    echo Node.js is already installed
)

:: Check for fd-find (optional but recommended for performance)
fd --version >nul 2>&1
if errorlevel 1 (
    echo fd-find not found. Attempting to install via winget...
    winget install sharkdp.fd
    if errorlevel 1 (
        echo Warning: Could not install fd-find. The application will still work but may be slower.
        echo You can manually install it later for better performance.
    ) else (
        echo fd-find installed successfully. Please restart the script.
        pause
        exit /b 0
    )
) else (
    echo fd-find is already installed
)

echo.
echo ============================================
echo          Setting up Backend
echo ============================================

:: Navigate to backend directory
cd /d "%QIMCHI_DIR%\qimchi-react\backend"
if errorlevel 1 (
    echo ERROR: Could not navigate to backend directory
    pause
    exit /b 1
)

:: Install Python dependencies with uv
echo Installing Python dependencies...
uv sync
if errorlevel 1 (
    echo ERROR: Failed to install Python dependencies
    pause
    exit /b 1
)

:: Install plotly chrome for kaleido
echo Installing plotly chrome support...
echo y | uv run python -c "import plotly; plotly.io.kaleido.scope.chromium.config.set_executable('chrome')" 2>nul || echo Plotly chrome setup completed

echo.
echo ============================================
echo          Setting up Frontend
echo ============================================

:: Navigate to frontend directory
cd /d "%QIMCHI_DIR%\qimchi-react\frontend"
if errorlevel 1 (
    echo ERROR: Could not navigate to frontend directory
    pause
    exit /b 1
)

:: Install npm dependencies
echo Installing npm dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: Failed to install npm dependencies
    pause
    exit /b 1
)

:: Build the React frontend
echo Building React frontend...
call npm run build
if errorlevel 1 (
    echo ERROR: Failed to build React frontend
    echo Checking if build output exists anyway...
    if not exist "dist\index.html" (
        echo No build output found. Build truly failed.
        pause
        exit /b 1
    ) else (
        echo Build output exists despite error code. Continuing...
    )
) else (
    echo React frontend built successfully
)

:: Create installation completion marker
echo Creating installation completion marker...
echo Installation completed on %DATE% %TIME% > "%INSTALL_MARKER%"
echo Git, Python, Node.js, backend and frontend setup complete >> "%INSTALL_MARKER%"

:start_server
echo.
echo ============================================
echo          Starting QIMCHI Server
echo ============================================

:: Navigate back to root directory
cd /d "%QIMCHI_DIR%\qimchi-react"

:: Set environment variables
set PYTHONPATH=%QIMCHI_DIR%\qimchi-react\backend
set PORT=8001
set SERVE_STATIC_FILES=true

echo Starting FastAPI server on port %PORT%...
echo Frontend will be served from: %QIMCHI_DIR%\qimchi-react\frontend\dist
echo Backend API available at: http://localhost:%PORT%/api
echo Web interface available at: http://localhost:%PORT%
echo.
echo Press Ctrl+C to stop the server
echo.

:: Start the FastAPI server using uvicorn in background
cd /d "%QIMCHI_DIR%\qimchi-react\backend"
echo Starting server...
start /min cmd /c "uv run uvicorn main:app --host 127.0.0.1 --port %PORT% --workers 8 --log-level info"

:: Wait a moment for server to start
echo Waiting for server to start...
timeout /t 3 /nobreak >nul

:: Try to open Firefox browser
echo Opening Firefox browser...
firefox.exe http://127.0.0.1:%PORT% 2>nul
if errorlevel 1 (
    echo Firefox not found in PATH. Trying alternative methods...
    :: Try common Firefox installation paths
    if exist "C:\Program Files\Mozilla Firefox\firefox.exe" (
        start "" "C:\Program Files\Mozilla Firefox\firefox.exe" http://127.0.0.1:%PORT%
    ) else if exist "C:\Program Files (x86)\Mozilla Firefox\firefox.exe" (
        start "" "C:\Program Files (x86)\Mozilla Firefox\firefox.exe" http://127.0.0.1:%PORT%
    ) else (
        echo Firefox not found. Opening with default browser...
        start http://127.0.0.1:%PORT%
    )
) else (
    echo Firefox opened successfully
)

echo.
echo ============================================
echo Server is running in background
echo Web interface: http://127.0.0.1:%PORT%
echo Press any key to stop the server and exit...
echo ============================================
pause >nul

:: Kill the uvicorn process when user presses a key
echo Stopping server...
taskkill /f /im python.exe 2>nul
taskkill /f /im uvicorn.exe 2>nul

:: If we get here, the server has stopped
echo.
echo Server stopped.
pause