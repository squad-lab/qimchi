@echo off
REM ============================================================================
REM QIMCHI Uninstall Script
REM
REM This script will:
REM 1. Stop any running QIMCHI servers
REM 2. Remove the .qimchi directory and all installed files
REM 3. Optionally uninstall dependencies (Git, Node.js, fd-find, uv)
REM
REM Usage: Double-click this file or run from command prompt
REM ============================================================================

setlocal EnableDelayedExpansion

:main
echo ============================================
echo        QIMCHI Uninstall Script
echo ============================================
echo.
echo WARNING: This will remove QIMCHI and all its data.
echo.
set /p "CONFIRM=Are you sure you want to uninstall QIMCHI? (yes/no): "

if /i not "%CONFIRM%"=="yes" (
    echo Uninstall cancelled.
    pause
    exit /b 0
)

echo.
echo ============================================
echo    Step 1: Stopping QIMCHI Servers
echo ============================================

:: Stop any running QIMCHI servers
echo Checking for running QIMCHI processes...
tasklist /FI "IMAGENAME eq python.exe" 2>nul | find /I "python.exe" >nul
if not errorlevel 1 (
    echo Stopping Python processes including uvicorn...
    taskkill /F /IM python.exe 2>nul
    echo Python processes stopped.
)
if errorlevel 1 echo No Python processes running.

tasklist /FI "IMAGENAME eq uvicorn.exe" 2>nul | find /I "uvicorn.exe" >nul
if not errorlevel 1 (
    echo Stopping uvicorn processes...
    taskkill /F /IM uvicorn.exe 2>nul
    echo Uvicorn processes stopped.
)
if errorlevel 1 echo No uvicorn processes running.

echo.
echo ============================================
echo    Step 2: Removing QIMCHI Directory
echo ============================================

set QIMCHI_DIR=%USERPROFILE%\.qimchi

if exist "%QIMCHI_DIR%" (
    echo Removing QIMCHI directory: %QIMCHI_DIR%
    echo This may take a moment...
    
    :: Change to home directory first to avoid permission issues
    cd /d "%USERPROFILE%"
    
    :: Remove the directory
    rmdir /s /q "%QIMCHI_DIR%" 2>nul
    
    if exist "%QIMCHI_DIR%" (
        echo WARNING: Could not completely remove %QIMCHI_DIR%
        echo Some files may be in use. Please close all related applications and try again.
        echo You can manually delete the directory: %QIMCHI_DIR%
    ) else (
        echo QIMCHI directory removed successfully.
    )
) else (
    echo QIMCHI directory not found. Nothing to remove.
)

echo.
echo ============================================
echo    Step 3: Optional Dependency Removal
echo ============================================
echo.
echo The following dependencies were potentially installed by QIMCHI:
echo   - Git
echo   - Node.js
echo   - fd-find
echo   - uv (Python package manager)
echo.
echo WARNING: These tools may be used by other applications.
echo Only uninstall them if you're sure they're not needed elsewhere.
echo.
set /p "REMOVE_DEPS=Do you want to uninstall these dependencies? (yes/no, default: no): "

if /i "%REMOVE_DEPS%"=="yes" (
    echo.
    echo Uninstalling dependencies...
    
    :: Check and uninstall Git
    git --version >nul 2>&1
    if not errorlevel 1 (
        echo.
        set /p "REMOVE_GIT=Uninstall Git? (yes/no, default: no): "
        if /i "!REMOVE_GIT!"=="yes" (
            echo Uninstalling Git...
            winget uninstall Git.Git --silent
            if not errorlevel 1 (
                echo Git uninstalled successfully.
            ) else (
                echo Failed to uninstall Git. You may need to uninstall it manually.
            )
        ) else (
            echo Skipping Git uninstall.
        )
    ) else (
        echo Git not found - skipping.
    )
    
    :: Check and uninstall Node.js
    node --version >nul 2>&1
    if not errorlevel 1 (
        echo.
        set /p "REMOVE_NODE=Uninstall Node.js? (yes/no, default: no): "
        if /i "!REMOVE_NODE!"=="yes" (
            echo Uninstalling Node.js...
            winget uninstall OpenJS.NodeJS
            if not errorlevel 1 (
                echo Node.js uninstalled successfully.
            ) else (
                echo Failed to uninstall Node.js. You may need to uninstall it manually.
            )
        ) else (
            echo Skipping Node.js uninstall.
        )
    ) else (
        echo Node.js not found - skipping.
    )
    
    :: Check and uninstall fd-find
    fd --version >nul 2>&1
    if not errorlevel 1 (
        echo.
        set /p "REMOVE_FD=Uninstall fd-find? (yes/no, default: no): "
        if /i "!REMOVE_FD!"=="yes" (
            echo Uninstalling fd-find...
            winget uninstall sharkdp.fd --silent
            if not errorlevel 1 (
                echo fd-find uninstalled successfully.
            ) else (
                echo Failed to uninstall fd-find. You may need to uninstall it manually.
            )
        ) else (
            echo Skipping fd-find uninstall.
        )
    ) else (
        echo fd-find not found - skipping.
    )
    
    :: Check and uninstall uv
    uv --version >nul 2>&1
    if not errorlevel 1 (
        echo.
        set /p "REMOVE_UV=Uninstall uv? (yes/no, default: no): "
        if /i "!REMOVE_UV!"=="yes" (
            echo Uninstalling uv...
            if exist "%USERPROFILE%\.local\bin\uv.exe" (
                del /f /q "%USERPROFILE%\.local\bin\uv.exe" 2>nul
                del /f /q "%USERPROFILE%\.local\bin\uvx.exe" 2>nul
                del /f /q "%USERPROFILE%\.local\bin\uvw.exe" 2>nul
                if not exist "%USERPROFILE%\.local\bin\uv.exe" (
                    echo uv uninstalled successfully.
                ) else (
                    echo Failed to uninstall uv. You may need to uninstall it manually.
                )
            ) else (
                echo uv installation not found in expected location.
            )
        ) else (
            echo Skipping uv uninstall.
        )
    ) else (
        echo uv not found - skipping.
    )
) else (
    echo Skipping dependency removal.
)

echo.
echo ============================================
echo        Uninstall Complete
echo ============================================
echo.
echo QIMCHI has been uninstalled.
echo.
if /i "%REMOVE_DEPS%"=="yes" (
    echo Dependencies were also processed according to your choices.
    echo Please restart your command prompt for changes to take full effect.
) else (
    echo Dependencies were left installed.
)
echo.
echo Thank you for using QIMCHI!
echo.
pause
