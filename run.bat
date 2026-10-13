@echo off
setlocal EnableDelayedExpansion
title AegiSec - AI Security Agent
cd /d "%~dp0"

if not exist "packages\aegisec" (
    echo [!] Cannot find packages\aegisec - run this file from the repository root.
    pause
    exit /b 1
)

echo ==================================================
echo            A E G I S E C
echo     The open source AI security agent
echo        Developed by Kranthi Yelaboina
echo ==================================================
echo.

rem ── Step 1: Ensure Bun runtime is available ────────────────────────
where bun >nul 2>nul
if %errorlevel%==0 (
    for /f "delims=" %%v in ('bun --version') do set "BUNVER=%%v"
    echo [OK] Bun !BUNVER! found.
) else (
    if exist "%USERPROFILE%\.bun\bin\bun.exe" (
        echo [OK] Bun found in %%USERPROFILE%%\.bun\bin ^(refreshing PATH^).
        set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
    ) else (
        echo [..] Bun not found. Downloading and installing...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
        if errorlevel 1 (
            echo.
            echo [!] Automatic Bun installation failed.
            echo     Please install it manually with:
            echo       powershell -c "irm bun.sh/install.ps1 | iex"
            echo     then run this file again.
            echo.
            pause
            exit /b 1
        )
        set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
        echo [OK] Bun installed.
    )
)
for /f "delims=" %%v in ('bun --version') do set "BUNVER=%%v"
echo [OK] Using bun v!BUNVER!.
echo.

rem ── Step 2: Install project dependencies (first run only) ──────────
if exist "node_modules" (
    echo [OK] Project dependencies already installed.
) else (
    echo [..] Installing project dependencies. First run only - please wait...
    echo.
    call bun install
    if errorlevel 1 (
        echo.
        echo [!] Dependency installation failed. Scroll up for details.
        echo     Tip: if a native build failed, install Visual Studio Build Tools
        echo     and re-run this launcher.
        echo.
        pause
        exit /b 1
    )
)
echo.

rem ── Step 3: Launch AegiSec TUI ─────────────────────────────────────
echo [..] Starting AegiSec... (close this window to exit)
echo.
call bun run --cwd packages\aegisec --conditions=browser src/index.ts %*
if errorlevel 1 (
    echo.
    echo [!] AegiSec exited with an error. Scroll up for details.
    pause
)
endlocal
