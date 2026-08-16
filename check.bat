@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "ROOT=%~dp0"

echo ========================================
echo   TestMaster Platform - Pre-flight
echo ========================================
echo.

set "PASS=0"
set "FAIL=0"

where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('node -v') do set "V=%%v"
    echo [PASS] Node.js: !V!
    set /a PASS+=1
) else (
    echo [FAIL] Node.js not found ^(need ^>= 20^)
    set /a FAIL+=1
)

where pnpm >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('pnpm -v') do set "V=%%v"
    echo [PASS] pnpm: !V!
    set /a PASS+=1
) else (
    echo [FAIL] pnpm not found ^(need pnpm@9^)
    set /a FAIL+=1
)

if exist "%ROOT%node_modules" (
    echo [PASS] node_modules exists
    set /a PASS+=1
) else (
    echo [WARN] node_modules missing - run start.bat to install
)

if exist "%ROOT%packages\app\package.json" (
    echo [PASS] Frontend package found
    set /a PASS+=1
) else (
    echo [FAIL] Frontend package missing
    set /a FAIL+=1
)

if exist "%ROOT%packages\orchestrator\package.json" (
    echo [PASS] Backend package found
    set /a PASS+=1
) else (
    echo [FAIL] Backend package missing
    set /a FAIL+=1
)

netstat -ano | findstr "LISTENING" | findstr ":3001 " >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARN] Port 3001 is in use ^(backend may conflict^)
) else (
    echo [PASS] Port 3001 available
    set /a PASS+=1
)

netstat -ano | findstr "LISTENING" | findstr ":5173 " >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARN] Port 5173 is in use ^(frontend may conflict^)
) else (
    echo [PASS] Port 5173 available
    set /a PASS+=1
)

echo.
echo ========================================
echo   Result: !PASS! passed, !FAIL! failed
if !FAIL! equ 0 (
    echo   Ready to launch! Run start.bat
) else (
    echo   Please fix the issues above before launching.
)
echo ========================================
echo.
pause
endlocal