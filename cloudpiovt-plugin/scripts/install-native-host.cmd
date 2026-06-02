@echo off
chcp 65001 >nul
setlocal
set "SCRIPT_DIR=%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo Not found: powershell.exe. Unable to install.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-native-host.ps1" -Browser all
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Error: %EXIT_CODE%
  pause
  exit /b %EXIT_CODE%
)

echo.
echo Success.
pause
