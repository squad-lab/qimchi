@echo off
REM ============================================================================
REM QIMCHI Windows Setup and Run Script
REM
REM This script will:
REM 1. Check for existing installation and skip setup if found
REM 2. Check and install Git via winget if not present
REM 3. Clone or update QIMCHI repository to %USERPROFILE%\.qimchi
REM    - Interactive branch selection during initial installation
REM 4. Create and activate Python virtual environment using uv
REM 5. Install Node.js via winget if not present
REM 6. Install fd-find for better performance (optional)
REM 7. Clone and install QCUtils with interactive branch selection
REM 8. Install Python backend dependencies using pip
REM 9. Install and build React frontend using npm
REM 10. Start the FastAPI server with static file serving
REM
REM Usage: Double-click this file or run from command prompt
REM The web interface will be available at http://localhost:8001
REM 
REM To force a fresh installation, delete: %USERPROFILE%\.qimchi\.qimchi_installed
REM ============================================================================

setlocal EnableDelayedExpansion

REM ============================================================================
REM Configuration Parameters - Edit these as needed
REM ============================================================================
set DEFAULT_QIMCHI_BRANCH=main
set DEFAULT_QCUTILS_BRANCH=main
REM ============================================================================

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
    echo    QIMCHI Already Installed - Quick Start
    echo ============================================
    echo Previous installation detected. Checking if everything is ready...
    
    :: Verify all components exist
    if exist "%QIMCHI_DIR%\qimchi-react\backend\main.py" (
        if exist "%QIMCHI_DIR%\qimchi-react\frontend\dist\index.html" (
            if exist "%QIMCHI_DIR%\qcutils" (
                echo Installation verified. Checking for updates...
                cd /d "%QIMCHI_DIR%\qimchi-react"
                
                :: Capture git pull output to check for frontend changes
                git pull origin > "%TEMP%\qimchi_git_pull.txt" 2>&1
                if errorlevel 1 (
                    echo Warning: Could not update repository. Using existing version.
                ) else (
                    :: Check if pull output indicates changes
                    findstr /C:"Already up to date" "%TEMP%\qimchi_git_pull.txt" >nul
                    if errorlevel 1 (
                        echo Repository updated. Checking for frontend changes...
                        :: Check if frontend directory was affected - can be a bit more discerning, e.g., checking only src/
                        findstr /C:"frontend/" "%TEMP%\qimchi_git_pull.txt" >nul
                        if not errorlevel 1 (
                            echo Frontend changes detected. Rebuilding frontend...
                            cd /d "%QIMCHI_DIR%\qimchi-react\frontend"
                            call npm install >nul 2>&1
                            call npm run build
                            if errorlevel 1 (
                                echo Warning: Frontend rebuild failed. Using existing build.
                            ) else (
                                echo Frontend rebuilt successfully.
                            )
                            cd /d "%QIMCHI_DIR%\qimchi-react"
                        ) else (
                            echo No frontend changes detected. Using existing build.
                        )
                    ) else (
                        echo Repository already up to date.
                    )
                )
                
                echo Starting server directly...
                goto :start_server
            ) else (
                echo QCUtils not found. Re-running setup...
                del "%INSTALL_MARKER%" 2>nul
            )
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
    echo.
    echo ============================================
    echo     Selecting QIMCHI Branch to Install
    echo ============================================
    
    :: Fetch available branches from GitLab
    echo Fetching available branches from repository...
    cd /d "%QIMCHI_DIR%"
    git ls-remote --heads https://gitlab.com/squad-lab/qimchi-react.git > "%TEMP%\qimchi_branches.txt"
    if errorlevel 1 (
        echo ERROR: Failed to fetch branches from repository
        echo Please check your internet connection and try again
        pause
        exit /b 1
    )
    
    :: Parse and display branches
    echo.
    echo Available branches:
    echo.
    set /a BRANCH_COUNT=0
    for /f "tokens=2" %%a in ('type "%TEMP%\qimchi_branches.txt"') do (
        set "BRANCH_FULL=%%a"
        :: Extract branch name after refs/heads/
        for /f "tokens=3 delims=/" %%b in ("!BRANCH_FULL!") do (
            set /a BRANCH_COUNT+=1
            set "BRANCH_!BRANCH_COUNT!=%%b"
            echo !BRANCH_COUNT!. %%b
        )
    )
    
    echo.
    set /p BRANCH_CHOICE="Select branch number (default: %DEFAULT_QIMCHI_BRANCH%): "
    
    :: Set default or validate choice
    if "!BRANCH_CHOICE!"=="" (
        set "SELECTED_BRANCH=%DEFAULT_QIMCHI_BRANCH%"
    ) else (
        call set "SELECTED_BRANCH=%%BRANCH_!BRANCH_CHOICE!%%"
        if "!SELECTED_BRANCH!"=="" (
            echo Invalid selection. Using default: %DEFAULT_QIMCHI_BRANCH%
            set "SELECTED_BRANCH=%DEFAULT_QIMCHI_BRANCH%"
        )
    )
    
    echo.
    echo Cloning QIMCHI repository from branch: !SELECTED_BRANCH!
    git clone --branch !SELECTED_BRANCH! --single-branch https://gitlab.com/squad-lab/qimchi-react.git
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
    git pull origin
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
echo              Setting up Backend
echo ============================================

:: Navigate to .qimchi directory
cd /d "%QIMCHI_DIR%"
if errorlevel 1 (
    echo ERROR: Could not navigate to .qimchi directory
    pause
    exit /b 1
)

:: Setup venv
echo Setting up Python virtual environment and activating...
uv venv --python 3.13 --seed --clear
call .\.venv\Scripts\activate.bat
if errorlevel 1 (
    echo ERROR: Failed to set up Python virtual environment
    pause
    exit /b 1
)

:: Navigate to backend directory
cd /d "%QIMCHI_DIR%\qimchi-react\backend"
if errorlevel 1 (
    echo ERROR: Could not navigate to backend directory
    pause
    exit /b 1
)

:: Install Python dependencies with uv
echo Installing Python dependencies...
uv pip install .
if errorlevel 1 (
    echo ERROR: Failed to install Python dependencies
    pause
    exit /b 1
)

:: Install plotly chrome for kaleido
echo Installing plotly chrome support...
echo y | python -c "import plotly; plotly.io.kaleido.scope.chromium.config.set_executable('chrome')" 2>nul || echo Plotly chrome setup completed

echo.
echo ============================================
echo             Setting up QCUtils
echo ============================================

:: Check if qcutils already exists, if not clone it
if not exist "%QIMCHI_DIR%\qcutils" (
    echo.
    echo ============================================
    echo     Selecting QCUtils Branch to Install
    echo ============================================
    
    :: Fetch available branches from GitLab
    echo Fetching available branches from qcutils repository...
    cd /d "%QIMCHI_DIR%"
    git ls-remote --heads https://gitlab.com/squad-lab/qcutils.git > "%TEMP%\qcutils_branches.txt"
    if errorlevel 1 (
        echo ERROR: Failed to fetch branches from qcutils repository
        echo Please check your internet connection and try again
        pause
        exit /b 1
    )
    
    :: Parse and display branches
    echo.
    echo Available branches:
    echo.
    set /a QCUTILS_BRANCH_COUNT=0
    for /f "tokens=2" %%a in ('type "%TEMP%\qcutils_branches.txt"') do (
        set "QCUTILS_BRANCH_FULL=%%a"
        :: Extract branch name after refs/heads/
        for /f "tokens=3 delims=/" %%b in ("!QCUTILS_BRANCH_FULL!") do (
            set /a QCUTILS_BRANCH_COUNT+=1
            set "QCUTILS_BRANCH_!QCUTILS_BRANCH_COUNT!=%%b"
            echo !QCUTILS_BRANCH_COUNT!. %%b
        )
    )
    
    echo.
    set /p QCUTILS_BRANCH_CHOICE="Select branch number (default: %DEFAULT_QCUTILS_BRANCH%): "
    
    :: Set default or validate choice
    if "!QCUTILS_BRANCH_CHOICE!"=="" (
        set "SELECTED_QCUTILS_BRANCH=%DEFAULT_QCUTILS_BRANCH%"
    ) else (
        call set "SELECTED_QCUTILS_BRANCH=%%QCUTILS_BRANCH_!QCUTILS_BRANCH_CHOICE!%%"
        if "!SELECTED_QCUTILS_BRANCH!"=="" (
            echo Invalid selection. Using default: %DEFAULT_QCUTILS_BRANCH%
            set "SELECTED_QCUTILS_BRANCH=%DEFAULT_QCUTILS_BRANCH%"
        )
    )
    
    echo.
    echo Cloning QCUtils repository from branch: !SELECTED_QCUTILS_BRANCH!
    cd /d "%QIMCHI_DIR%"
    git clone --branch !SELECTED_QCUTILS_BRANCH! --single-branch https://gitlab.com/squad-lab/qcutils.git
    if errorlevel 1 (
        echo ERROR: Failed to clone qcutils repository
        echo Please check your internet connection and try again
        pause
        exit /b 1
    )
    echo QCUtils repository cloned successfully
) else (
    echo QCUtils repository already exists
)

:: Install qcutils using pip into the backend virtual environment
echo Installing QCUtils into backend virtual environment...
cd /d "%QIMCHI_DIR%\qimchi-react\backend"
uv pip install "%QIMCHI_DIR%\qcutils"
if errorlevel 1 (
    echo ERROR: Failed to install qcutils
    pause
    exit /b 1
)
echo QCUtils installed successfully

echo.
echo ============================================
echo             Setting up Frontend
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
echo Git, Python, Node.js, qcutils, backend and frontend setup complete >> "%INSTALL_MARKER%"

:start_server
echo.
echo ============================================
echo          Starting QIMCHI Server
echo ============================================

:: Navigate back to root directory
cd /d "%QIMCHI_DIR%\qimchi-react"

:: Activate virtual environment
call "%QIMCHI_DIR%\.venv\Scripts\activate.bat"
if errorlevel 1 (
    echo Warning: Could not activate virtual environment
)

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
start /min cmd /c "uvicorn main:app --host 127.0.0.1 --port %PORT% --workers 8 --log-level info"

:: Wait for server health endpoint to become ready (wait up to 300 seconds)
echo Waiting for server to report healthy status (waiting up to 300s)...
set MAX_RETRIES=300
set /a RETRIES=0
set "HEALTH="

:wait_health
for /f "usebackq delims=" %%a in (`curl -s http://127.0.0.1:%PORT%/health 2^>nul`) do set "HEALTH=%%a"
if defined HEALTH (
    @REM echo Response: !HEALTH!
    echo !HEALTH! | findstr /i /c:"\"ok\":true" >nul
    if errorlevel 1 (
        rem ok flag not present or not true
    ) else (
        echo !HEALTH! | findstr /c:"\"id\"" >nul
        if errorlevel 1 (
            rem id not present
        ) else (
            echo Server healthy.
            goto :health_ready
        )
    )
)

set /a RETRIES+=1
if %RETRIES% GEQ %MAX_RETRIES% (
    echo ERROR: Server did not become healthy after %MAX_RETRIES% seconds.
    echo Last response: !HEALTH!
    goto :health_timeout
)

timeout /t 1 /nobreak >nul
goto :wait_health

:health_ready
rem Server is ready; continue

:health_timeout
rem Timeout reached; continuing anyway

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