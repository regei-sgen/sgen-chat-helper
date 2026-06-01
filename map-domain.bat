@echo off
setlocal
title Map sg-help-admin.test

:: --- Self-elevate to Administrator if we aren't already ---
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator rights -- click "Yes" on the prompt that appears...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

:: --- Running elevated from here ---
echo Mapping sg-help-admin.test -^> 127.0.0.1 in your hosts file...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\add-host.ps1"
ipconfig /flushdns >nul 2>&1

echo.
echo ============================================================
echo   Done.  Open:  http://sg-help-admin.test:5173
echo ============================================================
echo.
pause
