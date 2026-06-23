@echo off
REM 雙擊啟動 704 Minesweeper Electron app
setlocal enabledelayedexpansion
cd /d "%~dp0"
set PORT=3000

REM 1) 殺掉任何還掛在 PORT 上的舊 server
echo [704] cleanup: killing previous server on port %PORT% (if any)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  echo   killing PID %%a
  taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

REM 2) 第一次跑才裝套件
if not exist "node_modules\" (
  echo [704] first run: installing dependencies ^(含 Electron ~80MB^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo [704] npm install FAILED. Check error above.
    pause
    exit /b 1
  )
)

REM 3) 啟動 Electron app
echo [704] starting Electron app...
echo.
call npm start
set EXITCODE=%errorlevel%
echo.
echo [704] Electron exited with code %EXITCODE%
echo.
echo --- press any key to close this window ---
pause >nul

endlocal
