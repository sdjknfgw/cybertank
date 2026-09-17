@echo off
rem ============================================================
rem CyberTank one-click launcher
rem   - starts the backend (python server.py) automatically if
rem     it is not already running on port 8080
rem   - waits until the API responds, then opens the game in the
rem     default browser
rem   - call with argument "silent" to skip opening the browser
rem     (used by the Windows startup auto-launch)
rem ============================================================
setlocal EnableExtensions
cd /d "%~dp0"

set "CHECK=http://localhost:8080/api/leaderboard?mode=duel"
set "PORT=8080"

rem ---- 1) backend already running? ----
powershell -NoProfile -Command "try{Invoke-WebRequest -Uri '%CHECK%' -UseBasicParsing -TimeoutSec 2|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel%==0 goto open

rem ---- 2) locate a python interpreter (pythonw preferred: no window) ----
set "PYW="
where pythonw >nul 2>&1 && set "PYW=pythonw"
if not defined PYW (
  for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python*") do (
    if exist "%%D\pythonw.exe" set "PYW=%%D\pythonw.exe"
  )
)
if defined PYW (
  start "" /b "%PYW%" server.py %PORT%
  goto wait
)
where py >nul 2>&1
if %errorlevel%==0 (
  start "CyberTank backend" /min py -3 server.py %PORT%
) else (
  start "CyberTank backend" /min python server.py %PORT%
)

rem ---- 3) wait until the backend is ready (max ~15s) ----
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try{Invoke-WebRequest -Uri '%CHECK%' -UseBasicParsing -TimeoutSec 2|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel%==0 goto open
set /a tries+=1
if %tries% lss 15 goto wait
echo [CyberTank] backend failed to start. Please check your Python installation.
pause
exit /b 1

:open
if /i "%~1"=="silent" exit /b 0
start "" http://localhost:8080/
exit /b 0
