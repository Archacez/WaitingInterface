@echo off
rem Starts the local test and opens it in the default browser. Closing this window stops it.
cd /d "%~dp0.."
where node >nul 2>nul || (
  echo Node.js is required to run the local test. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node test\serve.js --open
pause
