@echo off
chcp 65001 >nul 2>&1
setlocal

set "ROOT=%~dp0"

echo ========================================
echo   TestMaster Platform - Stop Services
echo ========================================
echo.

cd /d "%ROOT%"
call node scripts\restart.mjs stop

echo.
pause
endlocal