@echo off
rem AI Floor Planner launcher
cd /d "%~dp0"
where node >NUL 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Please install it from https://nodejs.org
  pause
  exit /b 1
)
echo Starting AI Floor Planner...
echo Keep this window open while using the app. Close it to stop.
start "" "http://localhost:5173"
node server.js
echo.
echo The server stopped. If you see an error above, please send it to Claude.
pause
