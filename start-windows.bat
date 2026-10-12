@echo off
rem SwamiJet: double-click to start the server and open the app.
rem Keep this window open while you use the app. Closing it stops the server.
cd /d "%~dp0"
title SwamiJet server - keep this window open
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
if exist "server\node_modules" (
  call npm --prefix server run setup
) else (
  call npm run setup
)
if errorlevel 1 (
  echo.
  echo Setup did not finish. Read the message above. If it is about the password,
  echo open server\.env in Notepad, fix the password, save, and double-click this file again.
  pause
  exit /b 1
)
echo.
echo Opening http://localhost:8080 in your browser...
start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & explorer http://localhost:8080"
call npm --prefix server start
echo.
echo The SwamiJet server has stopped.
pause
