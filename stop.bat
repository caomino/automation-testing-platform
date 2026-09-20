@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "BACKEND_PORT=3001"
set "FRONTEND_PORT=5173"

echo ========================================
echo   TestMaster Platform - Stop
echo ========================================
echo.

echo Stopping backend (port %BACKEND_PORT%)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%BACKEND_PORT% "') do (
    echo   Killing PID %%p
    taskkill /F /PID %%p >nul 2>&1
)

echo Stopping frontend (port %FRONTEND_PORT%)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%FRONTEND_PORT% "') do (
    echo   Killing PID %%p
    taskkill /F /PID %%p >nul 2>&1
)

for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%BACKEND_PORT% "') do (
    echo   Force killing remaining PID %%p
    taskkill /F /PID %%p >nul 2>&1
)

for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%FRONTEND_PORT% "') do (
    echo   Force killing remaining PID %%p
    taskkill /F /PID %%p >nul 2>&1
)

echo.
echo [OK] All services stopped.
echo.
pause
endlocal