@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "ROOT=%~dp0"

echo ========================================
echo   TestMaster Platform - Restart (Production)
echo ========================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js ^>= 20.
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

echo.
echo [1/1] Running restart (build + stop + start)...
echo.

cd /d "%ROOT%"
call node scripts\restart.mjs restart

echo.
echo Done.
pause
endlocal