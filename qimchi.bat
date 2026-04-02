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
REM 7. Install Python backend dependencies using uv and pyproject.toml
REM 8. Install and build React frontend using npm
REM 9. Start the FastAPI server with static file serving
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
REM ============================================================================

:: Parse command-line args
set "FORCE_REINSTALL=0"
if /I "%~1"=="--force-reinstall" set "FORCE_REINSTALL=1"
if /I "%~1"=="/force" set "FORCE_REINSTALL=1"
if /I "%~1"=="/f" set "FORCE_REINSTALL=1"
if /I "%~1"=="-f" set "FORCE_REINSTALL=1"

REM Skip over function definitions
goto :main

REM ============================================================================
REM Function to refresh PATH from registry without restarting script
REM ============================================================================
:refresh_path
echo Refreshing PATH from registry...
set "USER_PATH="
set "SYSTEM_PATH="
for /f "skip=2 tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "USER_PATH=%%b"
for /f "skip=2 tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "SYSTEM_PATH=%%b"
if defined USER_PATH if defined SYSTEM_PATH set "PATH=!USER_PATH!;!SYSTEM_PATH!" & goto :path_done
if defined USER_PATH set "PATH=!USER_PATH!" & goto :path_done
if defined SYSTEM_PATH set "PATH=!SYSTEM_PATH!"
:path_done
REM Add Windows system directories (essential for built-in commands like findstr)
set "PATH=%SystemRoot%\system32;%PATH%"
set "PATH=%SystemRoot%;%PATH%"
set "PATH=%SystemRoot%\System32\Wbem;%PATH%"
set "PATH=%SystemRoot%\System32\WindowsPowerShell\v1.0\;%PATH%"
REM Add common tool paths to ensure they're available
set "PATH=%USERPROFILE%\.local\bin;%PATH%"
set "PATH=%LOCALAPPDATA%\Microsoft\WindowsApps;%PATH%"
set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
set "PATH=%ProgramFiles%\nodejs;%PATH%"
echo PATH refreshed successfully
goto :eof

:remove_qcutils
echo Checking for qcutils directory at %QIMCHI_DIR%...
if exist "%QIMCHI_DIR%\qcutils" (
    echo Found qcutils at %QIMCHI_DIR%\qcutils. Removing...
    rmdir /s /q "%QIMCHI_DIR%\qcutils"
    if exist "%QIMCHI_DIR%\qcutils" (
        echo WARNING: Failed to remove %QIMCHI_DIR%\qcutils. Please remove it manually.
    ) else (
        echo qcutils removed successfully.
    )
) else (
    echo No qcutils directory found in %QIMCHI_DIR%.
)
goto :eof
REM ============================================================================

:main
echo ============================================
echo          QIMCHI Setup and Run Script
echo ============================================
echo.
echo ============================================
echo    Step 1: Installing Dependencies
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
    echo Git installed successfully. Refreshing PATH...
    call :refresh_path
    echo.
) else (
    echo Git is already installed
)

:: Check if uv is installed, install if not
uv --version >nul 2>&1
if errorlevel 1 (
    echo uv not found. Installing uv via PowerShell installer...
    "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    if errorlevel 1 (
        echo ERROR: Failed to install uv
        echo Please check your internet connection and try again
        pause
        exit /b 1
    )
    echo uv installed successfully. Refreshing PATH...
    call :refresh_path
    echo.
    :: Verify uv is now available
    uv --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: uv installed but not found in PATH
        echo Please restart this script
        pause
        exit /b 1
    )
    echo uv verified and ready to use
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
    echo Node.js installed successfully. Refreshing PATH...
    call :refresh_path
    echo.
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
        echo fd-find installed successfully. Refreshing PATH...
        call :refresh_path
        echo.
    )
) else (
    echo fd-find is already installed
)

echo.
echo ============================================
echo    Step 2: Setting up QIMCHI
echo ============================================
echo.

:: Set up .qimchi directory in user home
set QIMCHI_DIR=%USERPROFILE%\.qimchi
set INSTALL_MARKER=%QIMCHI_DIR%\.qimchi_installed
echo Setting up QIMCHI in: %QIMCHI_DIR%

:: Force reinstall handling (via CLI flag)
if "%FORCE_REINSTALL%"=="1" (
    echo Force reinstall requested. Removing existing installation...
    if exist "%QIMCHI_DIR%" (
        echo Removing %QIMCHI_DIR%...
        rmdir /s /q "%QIMCHI_DIR%"
        if exist "%QIMCHI_DIR%" (
            echo ERROR: Failed to remove old installation directory
            echo Please manually delete: %QIMCHI_DIR%
            pause
            exit /b 1
        )
    )
    goto :restart_install
)

:: Check if QIMCHI_DIR exists first, if not, start fresh installation
if not exist "%QIMCHI_DIR%" (
    echo QIMCHI directory not found. Starting fresh installation...
    goto :restart_install
)

:: Check if installation is already complete
if exist "%INSTALL_MARKER%" (
    echo.
    echo ============================================
    echo    QIMCHI Already Installed - Quick Start
    echo ============================================
    echo Previous installation detected. Checking if everything is ready...
    
    :: Verify all components exist
    if not exist "%QIMCHI_DIR%\qimchi\backend\main.py" (
        echo Installation incomplete or corrupted. Re-running setup...
        del "%INSTALL_MARKER%" 2>nul
        goto :restart_install
    )
    if not exist "%QIMCHI_DIR%\qimchi\frontend\dist\index.html" (
        echo Installation incomplete or corrupted. Re-running setup...
        del "%INSTALL_MARKER%" 2>nul
        goto :restart_install
    )
    
    echo Installation verified. Checking branch status...
    :: Ensure qcutils is removed if present (no longer required by qimchi)
    call :remove_qcutils
    cd /d "%QIMCHI_DIR%\qimchi"
    
    :: Check if current branch exists on remote
    for /f "tokens=*" %%b in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%b"
    if not "!CURRENT_BRANCH!"=="" (
        echo Current branch: !CURRENT_BRANCH!
        git ls-remote --heads origin !CURRENT_BRANCH! > "%TEMP%\qimchi_branch_check.txt" 2>&1
        if not errorlevel 1 (
            :: Check if branch exists in output
            findstr /C:"refs/heads/!CURRENT_BRANCH!" "%TEMP%\qimchi_branch_check.txt" >nul
            if not errorlevel 1 (
                echo Branch exists on remote. Continuing...
                goto :branch_check_ok
            )
        )

        :: If we get here, branch was not found
        echo.
        echo ============================================
        echo           WARNING: Branch Not Found
        echo ============================================
        echo The current branch "!CURRENT_BRANCH!" does not exist on the remote repository.
        echo This may happen if the branch was deleted or renamed.
        echo.
        echo Switching to main branch...
        git fetch origin main >nul 2>&1
        git switch main
        if errorlevel 1 (
            echo ERROR: Failed to switch to main branch
            echo Your installation may be corrupted.
            echo.
        )
        if not errorlevel 1 (
            echo Successfully switched to main branch.
            echo.
        )
        
        echo Would you like to:
        echo   1. Reinstall QIMCHI completely (recommended)
        echo   2. Continue with current installation
        echo.
        set /p "BRANCH_FIX_CHOICE=Enter your choice (1 or 2, default: 1): "
        
        if "!BRANCH_FIX_CHOICE!"=="" set "BRANCH_FIX_CHOICE=1"
        if "!BRANCH_FIX_CHOICE!"=="1" (
            echo.
            echo Reinstalling QIMCHI...
            echo Removing old installation...
            cd /d "%USERPROFILE%"
            rmdir /s /q "%QIMCHI_DIR%" 2>nul
            if exist "%QIMCHI_DIR%" (
                echo ERROR: Failed to remove old installation directory
                echo Please manually delete: %QIMCHI_DIR%
                echo Then run this script again.
                pause
                exit /b 1
            )
            echo Old installation removed. Restarting installation process...
            echo.
            goto :restart_install
        )
        echo Continuing with current installation...
        echo.
    )
    if "!CURRENT_BRANCH!"=="" (
        echo Warning: Could not detect current branch
    )

    :branch_check_ok

    echo Checking for updates...
    :: Capture git pull output to check for frontend and backend dependency changes
    git pull origin > "%TEMP%\qimchi_git_pull.txt" 2>&1
    if errorlevel 1 (
        echo Warning: Could not update repository. Using existing version.
    ) else (
        :: Check if pull output indicates changes
        findstr /C:"Already up to date" "%TEMP%\qimchi_git_pull.txt" >nul
        if errorlevel 1 (
            echo Repository updated. Checking what changed...

            :: Rebuild frontend only if frontend files changed
            findstr /C:"frontend/" "%TEMP%\qimchi_git_pull.txt" >nul
            if not errorlevel 1 (
                echo Frontend changes detected. Rebuilding frontend...
                cd /d "%QIMCHI_DIR%\qimchi\frontend"
                call npm install >nul 2>&1
                call npm run build
                if errorlevel 1 (
                    echo Warning: Frontend rebuild failed. Using existing build.
                ) else (
                    echo Frontend rebuilt successfully.
                )
                cd /d "%QIMCHI_DIR%\qimchi"
            ) else (
                echo No frontend changes detected. Using existing build.
            )

            :: Reinstall backend dependencies if pyproject.toml changed
            set "PYPROJECT_CHANGED=0"
            findstr /C:"backend/pyproject.toml" "%TEMP%\qimchi_git_pull.txt" >nul
            if not errorlevel 1 set "PYPROJECT_CHANGED=1"

            if "!PYPROJECT_CHANGED!"=="0" (
                echo No backend dependency file changes detected.
            ) else (
                echo Reinstalling backend dependencies...
                cd /d "%QIMCHI_DIR%\qimchi\backend"
                if exist "%QIMCHI_DIR%\qimchi\backend\pyproject.toml" (
                    uv pip install --python "%QIMCHI_DIR%\.venv\Scripts\python.exe" .
                    if errorlevel 1 (
                        echo Warning: Failed to install backend package from pyproject.toml.
                    ) else (
                        echo Backend package installed successfully from pyproject.toml.
                    )
                ) else (
                    echo Warning: backend/pyproject.toml not found. Skipping pyproject install.
                )
                cd /d "%QIMCHI_DIR%\qimchi"
            )
        ) else (
            echo Repository already up to date.
        )
    )
    
    echo Starting server directly...
    goto :start_server
)

:restart_install
:: Create .qimchi directory if it doesn't exist
if not exist "%QIMCHI_DIR%" (
    echo Creating .qimchi directory...
    mkdir "%QIMCHI_DIR%"
)

:: Check if qimchi already exists, if not clone it
if not exist "%QIMCHI_DIR%\qimchi" (
    echo.
    echo ============================================
    echo     Selecting QIMCHI Branch to Install
    echo ============================================
    
    :: Fetch available branches from GitLab
    echo Fetching available branches from repository...
    cd /d "%QIMCHI_DIR%"
    git ls-remote --heads https://gitlab.com/squad-lab/qimchi.git > "%TEMP%\qimchi_branches.txt"
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
    git clone --branch !SELECTED_BRANCH! --single-branch https://gitlab.com/squad-lab/qimchi.git
    if errorlevel 1 (
        echo ERROR: Failed to clone repository
        echo Please check your internet connection and try again
        pause
        exit /b 1
    )
    echo Repository cloned successfully
) else (
    echo Repository already exists. Updating...
    cd /d "%QIMCHI_DIR%\qimchi"
    git pull origin
    if errorlevel 1 (
        echo Warning: Failed to update repository. Continuing with existing version...
    ) else (
        echo Repository updated successfully
    )
)

:: Navigate to the cloned repository
cd /d "%QIMCHI_DIR%\qimchi"
if errorlevel 1 (
    echo ERROR: Could not navigate to cloned repository
    pause
    exit /b 1
)

echo Current directory: %CD%
echo.

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
cd /d "%QIMCHI_DIR%\qimchi\backend"
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
echo             QCUtils cleanup
echo QCUtils is no longer required; ensuring qcutils is removed.
call :remove_qcutils

echo.
echo ============================================
echo             Setting up Frontend
echo ============================================

:: Navigate to frontend directory
cd /d "%QIMCHI_DIR%\qimchi\frontend"
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
cd /d "%QIMCHI_DIR%\qimchi"

:: Activate virtual environment
call "%QIMCHI_DIR%\.venv\Scripts\activate.bat"
if errorlevel 1 (
    echo Warning: Could not activate virtual environment
)

:: Set environment variables
set PYTHONPATH=%QIMCHI_DIR%\qimchi\backend
set PORT=8001
set SERVE_STATIC_FILES=true
set NUM_WORKERS=8

echo Starting FastAPI server on port %PORT%...
echo Frontend will be served from: %QIMCHI_DIR%\qimchi\frontend\dist
echo Backend API available at: http://localhost:%PORT%/api
echo Web interface available at: http://localhost:%PORT%
echo.
echo Press Ctrl+C to stop the server
echo.

:: Start the FastAPI server using uvicorn in background
cd /d "%QIMCHI_DIR%\qimchi\backend"
echo Starting server...
start /min cmd /c "uvicorn main:app --host 127.0.0.1 --port %PORT% --workers %NUM_WORKERS% --log-level info --ws-max-size 200000000 --ws-ping-interval 20 --ws-ping-timeout 20"

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

:: Kill all the QIMCHI processes when user presses a key
echo Stopping server...
echo Terminating QIMCHI server processes (port %PORT%)...

:: Find the process listening on the port and kill its entire tree
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo Killing process tree for PID %%p
    taskkill /f /t /pid %%p 2>nul
)

:: Give processes time to terminate
timeout /t 2 /nobreak >nul

:: If we get here, the server has stopped
echo.
echo Server stopped.
pause