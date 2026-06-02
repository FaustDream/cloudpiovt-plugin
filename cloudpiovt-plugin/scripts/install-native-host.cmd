@echo off
setlocal
set "SCRIPT_DIR=%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo 未找到 Windows PowerShell powershell.exe，无法继续安装原生助手。
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-native-host.ps1" -Browser all
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo 原生助手安装失败，错误码：%EXIT_CODE%
  pause
  exit /b %EXIT_CODE%
)

echo.
echo 原生助手安装完成，请重新打开扩展设置页查看运行状态。
pause
