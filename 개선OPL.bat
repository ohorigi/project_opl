@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and run again.
  pause
  exit /b 1
)
if not exist "node_modules\ws" (
  echo Installing packages...
  call npm install --no-audit --no-fund
)
node server.js --open
pause
