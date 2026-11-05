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
set CF=
where cloudflared >nul 2>nul && set CF=1
if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set CF=1
if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set CF=1
if not defined CF (
  echo Installing cloudflared - click Yes if Windows asks for permission...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
)
node server.js --open --tunnel
pause
