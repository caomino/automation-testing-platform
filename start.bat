@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "FRONTEND=%ROOT%packages\app"
set "BACKEND=%ROOT%packages\orchestrator"
set "BACKEND_PORT=3001"
set "FRONTEND_PORT=5173"

echo ========================================
echo   TestMaster Platform - Launcher
echo ========================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js ^>= 20.
    echo         Download: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
echo [OK] Node.js: %NODE_VER%

where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] pnpm not found. Install via: npm install -g pnpm@9
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('pnpm -v') do set "PNPM_VER=%%v"
echo [OK] pnpm: %PNPM_VER%
echo.

if not exist "%ROOT%node_modules" (
    echo [1/3] Installing dependencies...
    cd /d "%ROOT%"
    call pnpm install --no-frozen-lockfile
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed.
) else (
    echo [1/3] Dependencies already installed. Skipping.
)
echo.

echo [2/3] Checking ports...
netstat -ano | findstr "LISTENING" | findstr ":%BACKEND_PORT% " >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARN] Port %BACKEND_PORT% is already in use. Attempting to release...
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%BACKEND_PORT% "') do (
        echo         Killing PID %%p on port %BACKEND_PORT%
        taskkill /F /PID %%p >nul 2>&1
    )
)

netstat -ano | findstr "LISTENING" | findstr ":%FRONTEND_PORT% " >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARN] Port %FRONTEND_PORT% is already in use. Attempting to release...
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%FRONTEND_PORT% "') do (
        echo         Killing PID %%p on port %FRONTEND_PORT%
        taskkill /F /PID %%p >nul 2>&1
    )
)
echo [OK] Ports ready.
echo.

echo [3/3] Starting services...
echo.

start "TestMaster Backend (Port %BACKEND_PORT%)" cmd /k "cd /d "%ROOT%" && pnpm --filter @test-platform/orchestrator run server"
echo [OK] Backend started on port %BACKEND_PORT%

ping 127.0.0.1 -n 3 >nul

start "TestMaster Frontend (Port %FRONTEND_PORT%)" cmd /k "cd /d "%ROOT%" && pnpm --filter @test-platform/app dev"
echo [OK] Frontend started on port %FRONTEND_PORT%

echo.
echo ========================================
echo   Services launched!
echo   Frontend:  http://localhost:%FRONTEND_PORT%/
echo   Backend:   http://localhost:%BACKEND_PORT%/
echo   API Docs:  http://localhost:%BACKEND_PORT%/health
echo ========================================
echo.
echo Both services run in separate windows.
echo Close those windows to stop the services.
echo.
pause
endlocal